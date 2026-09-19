#!/usr/bin/env python3
"""pty_answer.py — roda um comando sob um PTY de verdade e responde a um prompt.

POR QUE ISSO EXISTE: o caminho INTERATIVO do remédio do pre-commit
(`scripts/pre-commit-remedy.mjs`) só pergunta quando o stdin É um
terminal (`process.stdin.isTTY`). Num subprocesso comum o stdin é um pipe, então
a direção interativa — a que o operador de verdade vê — ficava provada só por
dublê: `isTTY` INJETADO no teste, e a leitura real de uma linha num terminal
nunca exercitada. Um dublê que afirma `isTTY: true` prova a LÓGICA, não o
terminal; se o readline não funcionasse sob um tty de verdade (eco, modo cru,
fim de linha), o `isTTY` injetado passaria por cima e a suíte ficaria verde.

Aqui o comando roda com os TRÊS descritores ligados a um terminal alocado de
verdade (`pty.fork()`), e a resposta vai pelo MESMO terminal que o comando está
lendo — nada é injetado no processo.

ELA NÃO É SÓ PARA O REMÉDIO: qualquer comando que mude de comportamento conforme
o stdin ser terminal serve (`--expect`/`--answer` são opcionais).

Usage:
  python3 scripts/pty_answer.py [opções] -- <comando> [args...]
  python3 scripts/pty_answer.py --cwd /tmp/repo \\
    --env HOOK_UNDER_TEST=/tmp/repo/hook-under-test \\
    --expect "Aplicar? [s/N]" --answer s --meta /tmp/pty.json -- git commit -m x

Opções:
  --cwd DIR            diretório de trabalho do comando (default: o atual)
  --env NAME=VALUE     variável de ambiente (repetível; sobrepõe a herdada)
  --expect TEXTO       só responde DEPOIS de este texto aparecer na saída
  --answer TEXTO       o que escrever no terminal quando o `--expect` casar
  --timeout SEGUNDOS   teto total (default 90): estourou, o comando é MORTO
  --meta PATH          grava um JSON com os fatos da execução (ver abaixo)

Saída: TUDO o que o comando escreveu (stdout + stderr + eco do terminal), cru.
Os fatos do ensaio saem no `--meta`, para o transcript ficar limpo:

  {"status": 0, "signaled": null, "saw_expect": true, "answer_sent": true,
   "timed_out": false, "elapsed": 1.23, "bytes": 1204}

Exit codes (do PROCESSO — o mesmo do comando, para o ensaio não ter veredito
próprio):
  <status do comando>  o exit code dele, propagado tal e qual
  124                  o comando foi MORTO pelo --timeout (o `--expect` nunca
                       casou, por exemplo): um prompt que não aparece não vira
                       um ensaio verde
  125                  o harness não pôde rodar (sem `pty` nesta plataforma,
                       argumento inválido, cwd inexistente)
"""

import argparse
import errno
import json
import os
import pty
import select
import signal
import sys
import time


def parse_env(pares):
    env = {}
    for par in pares or []:
        if "=" not in par:
            raise SystemExit(f"❌ --env exige NOME=VALOR (recebi {par!r})")
        nome, valor = par.split("=", 1)
        env[nome] = valor
    return env


def exit_code_of(status):
    if hasattr(os, "waitstatus_to_exitcode"):
        return os.waitstatus_to_exitcode(status)
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    return 128 + os.WTERMSIG(status)


def main():
    try:
        import pty as _pty  # noqa: F401  (o import é a prova de disponibilidade)
    except Exception as erro:  # pragma: no cover - plataforma sem pty
        sys.stderr.write(
            "❌ pty não disponível nesta plataforma "
            f"({erro.__class__.__name__}: {erro}) — sem terminal não há ensaio "
            "interativo.\n"
        )
        return 125

    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--cwd", default=None)
    parser.add_argument("--env", action="append", default=[])
    parser.add_argument("--expect", default=None)
    parser.add_argument("--answer", default=None)
    parser.add_argument("--timeout", type=float, default=90.0)
    parser.add_argument("--meta", default=None)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()

    comando = [a for a in args.command if a != "--"]
    if not comando:
        sys.stderr.write("❌ nenhum comando: use `-- <comando> [args...]`\n")
        return 125

    cwd = args.cwd or os.getcwd()
    if not os.path.isdir(cwd):
        sys.stderr.write(f"❌ --cwd inexistente: {cwd}\n")
        return 125

    env = dict(os.environ)
    env.update(parse_env(args.env))
    # Sem TERM o readline do terminal assume um default; declarado para o
    # transcript não depender do ambiente de quem roda a suíte.
    env.setdefault("TERM", "dumb")

    inicio = time.time()
    pid, fd = pty.fork()
    if pid == 0:  # pragma: no cover - o filho vira o COMANDO
        try:
            os.chdir(cwd)
            os.execvpe(comando[0], comando, env)
        except Exception as erro:
            sys.stderr.write(f"❌ não executei {comando[0]!r}: {erro}\n")
            os._exit(125)

    buffer = ""
    resposta_enviada = False
    viu_expect = False
    estourou = False

    try:
        while True:
            if time.time() - inicio > args.timeout:
                estourou = True
                try:
                    os.killpg(pid, signal.SIGKILL)
                except OSError:
                    pass
                break
            pronto, _, _ = select.select([fd], [], [], 0.2)
            if pronto:
                try:
                    dados = os.read(fd, 65536)
                except OSError as erro:
                    if erro.errno == errno.EIO:  # o filho fechou o terminal
                        break
                    raise
                if not dados:
                    break
                texto = dados.decode("utf-8", "replace")
                buffer += texto
                sys.stdout.write(texto)
                sys.stdout.flush()
                if (
                    args.expect is not None
                    and args.answer is not None
                    and not resposta_enviada
                    and args.expect in buffer
                ):
                    viu_expect = True
                    os.write(fd, (args.answer + "\n").encode("utf-8"))
                    resposta_enviada = True
    finally:
        try:
            os.close(fd)
        except OSError:
            pass

    if estourou:
        try:
            _, status = os.waitpid(pid, 0)
        except ChildProcessError:
            status = 0

    if not estourou:
        _, status = os.waitpid(pid, 0)

    codigo = 124 if estourou else exit_code_of(status)

    if args.meta:
        with open(args.meta, "w", encoding="utf-8") as arquivo:
            json.dump(
                {
                    "status": codigo,
                    "signaled": None if os.WIFEXITED(status) else os.WTERMSIG(status),
                    "saw_expect": viu_expect,
                    "answer_sent": resposta_enviada,
                    "timed_out": estourou,
                    "elapsed": round(time.time() - inicio, 3),
                    "bytes": len(buffer.encode("utf-8")),
                    "command": comando,
                },
                arquivo,
            )

    if estourou:
        sys.stderr.write(
            f"\n❌ pty_answer: o comando não terminou em {args.timeout}s "
            "e foi MORTO — um prompt que não aparece não é um ensaio "
            "verde.\n"
        )
    return codigo


if __name__ == "__main__":
    sys.exit(main())
