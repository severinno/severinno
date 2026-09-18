/**
 * pre-commit-remedy-pty.test.ts
 *
 * O ensaio do remédio do pre-commit sob um TERMINAL de verdade (pty), sem
 * ninguém injetar `isTTY` — a pergunta é feita ao terminal e a resposta vai pelo
 * MESMO terminal que o processo está lendo.
 *
 * POR QUE O DUBLÊ NÃO BASTAVA: os testes irmãos exercitam a decisão do remédio
 * com `isTTY: true` e um `askFn` injetado. Isso prova a LÓGICA, não o terminal: o
 * `readline` lendo UMA linha de um tty de verdade (eco, modo cru, fim de linha) e
 * o `process.stdin.isTTY` real ficavam de fora — e é exatamente aí que a direção
 * interativa pode estar morta sem a suíte perceber.
 *
 * O QUE ESTE ARQUIVO MEDE (e o achado que só apareceu porque o terminal é real):
 *
 *   1. o harness É um terminal (controle): `isatty` verdadeiro nos três
 *      descritores, e falso num pipe — sem este controle, "o 'sim' foi aceito"
 *      poderia estar medindo um pipe com sorte;
 *   2. o remédio REAL sob o terminal: com o "sim" ele remenda a ÁRVORE,
 *      RE-ESTAGIA, revalida o recorte `--staged` e sai 0; com o "não" (e o ENTER
 *      vazio) não toca em nada; sem cicatriz mecânica nem pergunta;
 *   3. O FLUXO DO OPERADOR, medido: o git entrega ao hook o fd 0 em `/dev/null`
 *      (`isatty(0)` falso, com 1 e 2 no terminal) — o stdin do hook NÃO é um
 *      terminal, e é por isso que o remédio abre o TERMINAL DE CONTROLE
 *      (`/dev/tty`) para perguntar. A pergunta ACONTECE dentro de um `git
 *      commit`: o "sim" no terminal remenda, re-estagia e o commit ENTRA; o "não"
 *      bloqueia; e numa sessão SEM terminal de controle (processo em sessão
 *      própria, o caso do CI) ele NÃO pergunta e o commit fica bloqueado com o
 *      caminho à mão — fail-closed.
 *   4. O CAMINHO DA FASE B, medido no fluxo do operador: com o defeito de
 *      ENCODING (e não a cicatriz de `run:`) a pergunta TAMBÉM acontece, o
 *      remédio remenda e re-estagia — e quem dá o veredito é a FASE, rodada de
 *      novo pelo hook. Uma fase que VOLTA a reprovar bloqueia o commit mesmo com
 *      o remédio verde; uma fase que passa na segunda medição deixa o commit
 *      ENTRAR. As duas metades juntas é que provam que a reexecução existe: sem
 *      ela o primeiro caso passaria e o segundo não entraria.
 *
 * O item 3 é o que a medição manual não dava: o `isTTY` injetado fazia a direção
 * interativa parecer alcançável pelo hook (e, antes do `/dev/tty`, ela de fato não
 * era). Está pinado aqui como FATO medido — se o git (ou o remédio) mudar de
 * comportamento, este teste muda junto, de propósito.
 *
 * Sem rede e sem docker. O pty exige um interpretador com o módulo `pty` (POSIX):
 * onde ele não existe o ensaio se declara INDISPONÍVEL com o motivo nomeado (e o
 * contraste do item 3 continua rodando) — um harness que "passasse" sem ter
 * alocado terminal seria a garantia decorativa que o repositório recusa.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/pre-commit-remedy-pty.test.ts
 */

import { readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import type { SpawnSyncOptionsWithStringEncoding } from "node:child_process"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  COMPLETOU,
  cleanupFixtures,
  commitObjects,
  committedContent,
  harnessPath,
  headExists,
  HOOK_UNDER_TEST,
  novoRepo as novoRepoSim,
  shellParses,
  stage,
  tempDir,
} from "@/lib/__tests__/helpers/hook-simulator"
import {
  GUARD_CLOSURE,
  HOOK,
  WORKFLOW,
  WORKFLOW_CICATRIZ,
  WORKFLOW_QUEBRADO,
  WORKFLOW_VALIDO,
  WRAPPER_SOURCE,
  novoRepo,
  writeHooksShim,
} from "@/lib/__tests__/helpers/pre-commit-fixture"
import { NO_PROMPT_ENV, OFFER_MARKER } from "../../../scripts/pre-commit-remedy.mjs"
import { ptyAvailability, ptyRun } from "../../../scripts/pty-harness.mjs"

afterAll(() => {
  cleanupFixtures()
})

/** O interpretador que tem o `pty` (o mesmo que roda o harness). */
const PTY = ptyAvailability()
const PYTHON = PTY.available ? PTY.command! : null

/** Um repo do fixture com o hook REAL instalado no `core.hooksPath`. */
function repo(): string {
  const dir = novoRepo()
  writeHooksShim(dir)
  return dir
}

/** O ambiente que o fixture usa para o git invocar o hook dele (mesma régua). */
function envDoHook(dir: string, hookUnderTest?: string): Record<string, string> {
  return { PATH: harnessPath(), HOOK_UNDER_TEST: hookUnderTest ?? join(dir, HOOK_UNDER_TEST) }
}

/**
 * O remédio INVOCADO DIRETO sob o terminal (o caminho interativo alcançável).
 *
 * A variável de desligamento vai EXPLICITAMENTE VAZIA: o ensaio mede a pergunta
 * ACONTECENDO, e um operador que a tenha ligado no ambiente global não pode
 * transformar este teste em "o remédio não perguntou" (o outro caminho, que é o
 * do `hook-simulator`, desliga de propósito).
 */
function remedyUnderPty(dir: string, answer: string | null = null) {
  return ptyRun({
    command: [process.execPath, "scripts/pre-commit-remedy.mjs"],
    cwd: dir,
    env: { [NO_PROMPT_ENV]: "" },
    expect: OFFER_MARKER,
    answer,
    python: PYTHON,
    timeoutMs: 60_000,
  })
}

/** A abre (ou não) o `/dev/tty` do próprio processo: o veredito é o exit code. */
const ABRE_TTY_PY = ["import os", 'os.close(os.open("/dev/tty", os.O_RDONLY))', ""].join("\n")

/** Mede, DENTRO da sessão do hook, quem consegue abrir o terminal de controle. */
const SONDA_TTY_PY = [
  "import os, subprocess, sys",
  "AQUI = os.path.dirname(os.path.abspath(__file__))",
  "for detached in (False, True):",
  '    r = subprocess.run([sys.executable, os.path.join(AQUI, "abre-tty.py")],',
  "                       preexec_fn=(os.setsid if detached else None))",
  '    print("tty detached", detached, "ABRE" if r.returncode == 0 else "NAO ABRE")',
  "",
].join("\n")

/**
 * O commit do fixture sob o terminal: quem executa o hook é o GIT, com o fd 0 do
 * hook em `/dev/null` e o TERMINAL DE CONTROLE no 1 e no 2 (é assim que o git o
 * invoca). A resposta vai pelo terminal, depois de o remédio perguntar no
 * `/dev/tty`.
 */
function commitUnderPty(
  dir: string,
  answer: string | null = "s",
  extraEnv: Record<string, string> = {},
) {
  return ptyRun({
    command: ["git", "commit", "-m", "commit do fixture"],
    cwd: dir,
    env: { ...envDoHook(dir), [NO_PROMPT_ENV]: "", ...extraEnv },
    expect: OFFER_MARKER,
    answer,
    python: PYTHON,
    timeoutMs: 60_000,
  })
}

/**
 * O MESMO commit numa sessão SEM terminal de controle: o processo roda com
 * `setsid` (o que `detached: true` faz), então não há `/dev/tty` para abrir — e a
 * resposta oferecida num PIPE não é lida (o stdin do hook não é um terminal, e
 * não há outro de onde ler). É o caso do CI.
 */
function commitSemTerminal(dir: string, resposta = "s\n") {
  // O cast é DECLARADO: o runtime do `spawnSync` honra `detached` (medido — é ele
  // que faz o `/dev/tty` não abrir), mas o `@types/node` 26 o declara só em
  // `SpawnOptions`, não em `SpawnSyncOptions`. Sem o cast o typecheck recusa; sem
  // o `detached` o ensaio mediria o terminal de quem roda a suíte.
  const res = spawnSync("git", ["commit", "-m", "commit do fixture"], {
    cwd: dir,
    encoding: "utf8",
    input: resposta,
    timeout: 60_000,
    env: { ...process.env, ...envDoHook(dir) },
    detached: true,
  } as SpawnSyncOptionsWithStringEncoding)
  return { status: res.status, output: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

// ── o harness: o pty É um TERMINAL (o controle) ───────────────────────────

describe("o harness do terminal", () => {
  it("declara a própria disponibilidade com o MOTIVO (nunca um verde por omissão)", () => {
    if (PTY.available) {
      expect(PTY.command).toBeTruthy()
      expect(PTY.reason).toBe("")
    } else {
      // Sem `pty`, o motivo NOMEIA o que foi tentado: é ele que o consumidor
      // publica ao pular, em vez de um `.skip` mudo.
      expect(PTY.reason).toContain("pty")
      expect(PTY.reason).toContain("tentei")
    }
  })

  it.skipIf(!PTY.available)("os TRÊS descritores são um terminal — e num pipe não são", () => {
    // O controle que torna o resto confiável: se o harness alocasse um pipe (ou
    // herdasse o do teste), "o 'sim' foi aceito" mediria outra coisa.
    const sonda = "import os; print('isatty', os.isatty(0), os.isatty(1), os.isatty(2))"
    const sobPty = ptyRun({ command: [PYTHON!, "-c", sonda], python: PYTHON })
    expect(sobPty.status).toBe(0)
    expect(sobPty.output).toContain("isatty True True True")

    const sobPipe = spawnSync(PYTHON!, ["-c", sonda], { encoding: "utf8", input: "" })
    expect(sobPipe.stdout).toContain("isatty False False False")
  })

  it.skipIf(!PTY.available)("o exit code do comando atravessa o harness tal e qual", () => {
    const r = ptyRun({ command: [PYTHON!, "-c", "import sys; sys.exit(7)"], python: PYTHON })
    expect(r.status).toBe(7)
    expect(r.meta).toMatchObject({ status: 7, timed_out: false })
  })

  it.skipIf(!PTY.available)(
    "um prompt que NUNCA aparece não vira ensaio verde: o comando é MORTO no teto",
    () => {
      const r = ptyRun({
        command: [PYTHON!, "-c", "import time; time.sleep(30)"],
        expect: "PERGUNTA_QUE_NAO_EXISTE",
        answer: "s",
        python: PYTHON,
        timeoutMs: 3_000,
      })
      expect(r.timedOut).toBe(true)
      expect(r.status).toBe(124)
      expect(r.meta).toMatchObject({ saw_expect: false, answer_sent: false, timed_out: true })
      expect(r.output).toContain("não terminou")
    },
  )
})

// ── a direção INTERATIVA, com o remédio REAL sob o terminal ─────────────

describe.skipIf(!PTY.available)("o remédio sob um TERMINAL de verdade", () => {
  it("'sim': pergunta, remenda a ÁRVORE, RE-ESTAGIA e REVALIDA (exit 0)", () => {
    const dir = repo()
    // A cicatriz MECÂNICA (operador pendente no fim do corpo) — a única que o
    // remédio sabe remendar. O defeito não-remendável tem teste próprio abaixo.
    stage(dir, WORKFLOW, WORKFLOW_CICATRIZ)

    const r = remedyUnderPty(dir, "s")

    // 1. Houve PERGUNTA no terminal, e a resposta foi escrita nele.
    expect(r.reason).toBe("")
    expect(r.timedOut).toBe(false)
    expect(r.meta?.saw_expect).toBe(true)
    expect(r.answerSent).toBe(true)
    expect(r.status).toBe(0)
    // 2. O remendo está na ÁRVORE e no ÍNDICE (o `git add` do remédio levou o
    // remendo ao commit; sem ele o commit carregaria a versão recusada).
    const remendado = readFileSync(join(dir, WORKFLOW), "utf8")
    expect(remendado).toContain('echo "um"')
    expect(remendado).not.toContain("&&")
    expect(committedContentIndex(dir, WORKFLOW)).toBe(remendado)
    // 3. E o operador viu os três efeitos ditos ANTES de responder.
    expect(r.output).toContain("remenda a ÁRVORE")
    expect(r.output).toContain("re-estagiado")
    expect(r.output).toContain("recorte `--staged` voltou a passar")
  })

  it("'não' e ENTER vazio: nada é remendado (árvore e índice byte a byte)", () => {
    for (const resposta of ["n", ""]) {
      const dir = repo()
      stage(dir, WORKFLOW, WORKFLOW_CICATRIZ)
      const antes = readFileSync(join(dir, WORKFLOW), "utf8")

      const r = remedyUnderPty(dir, resposta)

      expect(r.meta?.saw_expect, `resposta ${JSON.stringify(resposta)}`).toBe(true)
      expect(r.answerSent).toBe(true)
      expect(r.status).not.toBe(0)
      expect(r.output).toContain("NADA foi remendado")
      expect(readFileSync(join(dir, WORKFLOW), "utf8")).toBe(antes)
      expect(committedContentIndex(dir, WORKFLOW)).toBe(antes)
    }
  })

  it("sem CICATRIZ MECÂNICA não pergunta: a resposta não é o que faz passar", () => {
    const dir = repo()
    // `if` sem `fi`: corpo quebrado, e NÃO a cicatriz que o remédio conhece — a
    // pergunta nem existiria (a resposta não mudaria nada).
    stage(dir, WORKFLOW, WORKFLOW_QUEBRADO)

    const r = remedyUnderPty(dir, "s")

    expect(r.meta?.saw_expect).toBe(false)
    expect(r.answerSent).toBe(false)
    expect(r.status).not.toBe(0)
    expect(r.output).toContain("não há cicatriz MECÂNICA para remendar")
  })
})

// ── o fluxo REAL do operador: o hook invocado PELO GIT ───────────────────

describe("o hook invocado PELO GIT (o fluxo do operador)", () => {
  it.skipIf(!PTY.available)(
    "o git NÃO dá um terminal ao stdin do hook — o terminal fica no 1 e no 2",
    () => {
      // A MEDIÇÃO CAUSAL: não é opinião sobre o git, é o `isatty`/`readlink` do
      // fd 0 medido DENTRO do hook. É ela que explica por que o remédio abre o
      // `/dev/tty` para perguntar — e é ela que muda se o git mudar de
      // comportamento. (Neste caminho o git liga o fd 0 em `/dev/null`; por outra
      // camada de shell ele pode chegar como pipe. O que é estável, e é o que o
      // remédio consulta, é: NÃO é um terminal.)
      const dir = repo()
      const sonda = join(dir, "sonda-do-hook.sh")
      writeFileSync(
        sonda,
        [
          "#!/bin/sh",
          `${PYTHON!} -c "import os; print('isco0', os.isatty(0), 'isco1', os.isatty(1), 'isco2', os.isatty(2), 'fd0', os.readlink('/proc/self/fd/0'))"`,
          "exit 1",
        ].join("\n"),
        "utf8",
      )

      const r = ptyRun({
        command: ["git", "commit", "-m", "commit do fixture"],
        cwd: dir,
        env: envDoHook(dir, sonda),
        python: PYTHON,
        timeoutMs: 30_000,
      })

      // O stdin do hook NÃO é o terminal (e o fd 0 nomeia o que ele é)...
      expect(r.output).toContain("isco0 False")
      expect(r.output).toContain("fd0 /dev/null")
      // ...enquanto o terminal ESTÁ do outro lado: é por isso que o operador vê
      // as mensagens do remédio — e por isso o remédio abre o `/dev/tty` para
      // perguntar (é o `isatty` do 0, e não o do 1, que ele consulta).
      expect(r.output).toContain("isco1 True")
      expect(r.output).toContain("isco2 True")

      // O CONTROLE do mecanismo, medido no mesmo terminal: um filho desta sessão
      // abre o `/dev/tty` (herda o terminal de controle); um filho em SESSÃO
      // própria (`setsid`) não tem nenhum para abrir. É essa diferença que separa
      // "pergunta" de "SEM TERMINAL" — e é o que o teste do fail-closed usa.
      const sonda2 = join(dir, "sonda-do-tty.sh")
      // A sonda é PYTHON porque `os.setsid` é uma linha (a sessão própria é o que
      // ela precisa controlar) e porque o interpretador já vem resolvido pelo
      // harness (`PYTHON`), sem depender do PATH do hook. O que se mede aqui não é
      // o remédio, é o `/dev/tty` do PROCESSO: um filho da sessão herda o terminal
      // de controle e abre; um filho em sessão própria (`os.setsid`, o que
      // `detached: true` faz) não tem nenhum para abrir. São dois arquivos porque
      // a aspa aninhada de um `-c` numa casca vira o escape mais frágil do
      // arquivo.
      writeFileSync(join(dir, "abre-tty.py"), ABRE_TTY_PY, "utf8")
      writeFileSync(join(dir, "sonda-tty.py"), SONDA_TTY_PY, "utf8")
      writeFileSync(
        sonda2,
        ["#!/bin/sh", `${PYTHON!} ${join(dir, "sonda-tty.py")}`, "exit 1"].join("\n"),
        "utf8",
      )
      const r2 = ptyRun({
        command: ["git", "commit", "-m", "commit do fixture"],
        cwd: dir,
        env: envDoHook(dir, sonda2),
        python: PYTHON,
        timeoutMs: 30_000,
      })
      // (`False`/`True` são do `print` do Python — o veredito é o exit code.)
      expect(r2.output).toContain("tty detached False ABRE")
      expect(r2.output).toContain("tty detached True NAO ABRE")
    },
  )

  it.skipIf(!PTY.available)(
    "por isso o 'sim' no TERMINAL faz o commit ENTRAR (o remédio pergunta pelo /dev/tty)",
    () => {
      const dir = repo()
      stage(dir, WORKFLOW, WORKFLOW_CICATRIZ)

      const r = commitUnderPty(dir, "s")

      // 1. A pergunta ACONTECEU dentro do `git commit` — e o stdin do hook era
      // /dev/null (medido no teste acima). Quem respondeu foi o /dev/tty.
      expect(r.reason).toBe("")
      expect(r.timedOut).toBe(false)
      expect(r.meta?.saw_expect).toBe(true)
      expect(r.answerSent).toBe(true)
      // 2. O remédio revalidou o ÍNDICE e o hook o deixou passar: o commit ENTRA.
      expect(r.status).toBe(0)
      expect(commitObjects(dir)).toBe(1)
      expect(headExists(dir)).toBe(true)
      // 3. O que o commit GRAVOU é o corpo remendado — o remédio levou o remendo
      // ao índice (sem o `git add` dele o commit carregaria a versão recusada).
      const remendado = readFileSync(join(dir, WORKFLOW), "utf8")
      expect(remendado).not.toContain("&&")
      expect(committedContent(dir, WORKFLOW)).toBe(remendado)
      expect(r.output).toContain("recorte `--staged` voltou a passar")
    },
  )

  it.skipIf(!PTY.available)("o 'não' no terminal BLOQUEIA o commit e não remenda nada", () => {
    const dir = repo()
    stage(dir, WORKFLOW, WORKFLOW_CICATRIZ)
    const antes = readFileSync(join(dir, WORKFLOW), "utf8")

    const r = commitUnderPty(dir, "n")

    expect(r.meta?.saw_expect).toBe(true)
    expect(r.answerSent).toBe(true)
    expect(r.status).not.toBe(0)
    expect(r.output).toContain("NADA foi remendado")
    expect(commitObjects(dir)).toBe(0)
    expect(headExists(dir)).toBe(false)
    expect(readFileSync(join(dir, WORKFLOW), "utf8")).toBe(antes)
  })

  it("SEM terminal de controle (sessão própria): não pergunta, não lê a resposta do pipe e BLOQUEIA", () => {
    const dir = repo()
    stage(dir, WORKFLOW, WORKFLOW_CICATRIZ)
    const antes = readFileSync(join(dir, WORKFLOW), "utf8")

    // Os MESMOS bytes que o ensaio do pty manda ("s" + ENTER), agora num pipe
    // de uma sessão SEM terminal de controle: o remédio não pergunta (o stdin
    // não é um terminal e o /dev/tty não abre), a resposta não é consumida e
    // nada é remendado. É o caso do CI.
    const r = commitSemTerminal(dir, "s\n")

    expect(r.output).toContain("SEM TERMINAL")
    expect(r.output).toContain("/dev/tty não abriu")
    expect(r.output).toContain("node scripts/check-workflow-run-syntax.mjs --fix")
    expect(r.status).not.toBe(0)
    expect(commitObjects(dir)).toBe(0)
    expect(readFileSync(join(dir, WORKFLOW), "utf8")).toBe(antes)
  })
})

// ── o REMÉDIO pelo caminho da FASE B (e quem dá o veredito é a fase) ─────

/**
 * Os guards de ENCODING: o que a fase B executa e o remédio SPAWNA pelo caminho.
 * Eles entram no fixture por CÓPIA declarada (o wrapper da casa não os importa),
 * e sem eles a classe se declara inaplicável — o caminho da fase B ficaria sem
 * nada para remendar, que é o oposto do que este ensaio mede.
 */
const FECHO_ENCODING = [
  "check-crlf.sh",
  "check_crlf.py",
  "check-blob-crlf.sh",
  "check_blob_crlf.py",
  "check-utf8.sh",
  "check_utf8.py",
]

/** O defeito da fase B que o remédio conhece: CRLF num `.sh` rastreado. */
const SH_COM_CRLF = "#!/usr/bin/env bash\r\necho oi\r\n"
const SH_EM_LF = "#!/usr/bin/env bash\necho oi\n"

/**
 * O dublê da FASE B: `run-encoding-guards.sh` REPROVA (é o defeito do cenário) e
 * o resto do `bash` continua real. O `node` do wrapper da casa segue como está —
 * real para o GUARD e para o REMÉDIO, 0 para os irmãos de fase —, então o remédio
 * que roda aqui é o de VERDADE, com os guards de verdade.
 *
 * `marca` ausente = a fase B reprova SEMPRE (a reexecução também). Com um
 * caminho, a PRIMEIRA medição reprova e a SEGUNDA passa: é essa diferença que
 * separa "a reexecução aconteceu e decidiu" de "o hook desistiu na primeira".
 */
function wrapperDaFaseB(marca: string | null) {
  const decisao =
    marca === null
      ? ["        return 1 ;;"].join("\n")
      : [
          // `:?` e nao `:-`: sem a variável o dublê ABORTA (e o commit é
          // bloqueado), em vez de responder "a fase passou" por acidente.
          '        if [ ! -e "${FASE_B_MARCA:?}" ]; then',
          '          : > "$FASE_B_MARCA"',
          "          return 1",
          "        fi",
          "        return 0 ;;",
        ].join("\n")
  const bashDaFaseB = [
    "# O `bash` da FASE B: o runner de encoding REPROVA (o defeito do cenário);",
    "# o resto continua real. Redefinido DEPOIS do `bash` gerado — a última",
    "# definição de função é a que vale.",
    "bash() {",
    '  for _a in "$@"; do',
    '    case "$_a" in',
    "      *run-encoding-guards.sh*)",
    decisao,
    "    esac",
    "  done",
    '  command bash "$@"',
    "}",
  ].join("\n")
  const wrapper = WRAPPER_SOURCE.replace(
    '\n. "$HOOK_UNDER_TEST"',
    `\n${bashDaFaseB}\n. "$HOOK_UNDER_TEST"`,
  )
  // Fail-closed do PRÓPRIO ensaio: se a âncora do wrapper gerado mudar, o
  // `replace` vira no-op e o teste mediria uma fase B VERDE (o commit entrando
  // onde ele tem de ser bloqueado) — melhor parar aqui, nomeando o motivo.
  if (!wrapper.includes("run-encoding-guards.sh")) {
    throw new Error("o dublê da fase B não foi sobreposto: a âncora do wrapper mudou")
  }
  return wrapper
}

/**
 * Um repo do fixture cuja FASE B reprova, com os guards de encoding dentro e o
 * hook REAL instalado no `core.hooksPath`.
 */
function repoDaFaseB(marca: string | null = null) {
  const dir = novoRepoSim({
    prefix: "remedy-fase-b-",
    closure: [...GUARD_CLOSURE, ...FECHO_ENCODING],
    wrapper: wrapperDaFaseB(marca),
    dirs: [".github/workflows"],
  })
  writeHooksShim(dir)
  return dir
}

describe("o remédio pelo caminho da FASE B (o defeito é de encoding)", () => {
  it.skipIf(!PTY.available)(
    "a pergunta ACONTECE; e com a fase ainda vermelha o commit NÃO entra",
    () => {
      const dir = repoDaFaseB(null)
      stage(dir, "scripts/quebrado.sh", SH_COM_CRLF)

      const r = commitUnderPty(dir, "s")

      // 1. A pergunta aconteceu TAMBÉM para um defeito que não é a cicatriz de
      // `run:` — é o que a extensão da oferta promete.
      expect(r.reason).toBe("")
      expect(r.meta?.saw_expect).toBe(true)
      expect(r.answerSent).toBe(true)
      expect(r.output).toContain("check-crlf.sh")
      // 2. O remédio aplicou e re-estagiou: o ÍNDICE já carrega o `.sh` em LF.
      expect(committedContentIndex(dir, "scripts/quebrado.sh")).toBe(SH_EM_LF)
      // 3. ...e MESMO ASSIM o commit não entra: quem decide é a FASE, rodada de
      // novo pelo hook, e ela reprovou outra vez. Sem a reexecução o remédio
      // verde (exit 0) teria deixado o commit passar por cima da fase.
      expect(r.status).not.toBe(0)
      expect(commitObjects(dir)).toBe(0)
      expect(headExists(dir)).toBe(false)
      expect(r.output).not.toContain(COMPLETOU)
    },
  )

  it.skipIf(!PTY.available)(
    "MUTAÇÃO: sem a reexecução, o remédio verde deixa o commit passar com a fase vermelha",
    () => {
      // A metade que torna a reexecução LOAD-BEARING: apagada a linha que roda a
      // fase de novo, o mesmo cenário do primeiro teste (fase B sempre vermelha,
      // remédio verde) passa a deixar o commit ENTRAR — o remédio estaria dando o
      // veredito da fase que ele não mede.
      const marca = join(tempDir("fase-b-mutada-"), "marca")
      const dir = repoDaFaseB(marca)
      stage(dir, "scripts/quebrado.sh", SH_COM_CRLF)

      const REVALIDACAO = 'if [ "$FASE_B" -ne 0 ]; then\n    fase_b\n  fi'
      const hook = readFileSync(HOOK, "utf8")
      expect(hook).toContain(REVALIDACAO) // a mutação precisa aplicar de fato
      const mutado = hook.replace(REVALIDACAO, "")
      expect(mutado).not.toBe(hook)
      // Uma mutação que quebrasse a sintaxe do hook sairia vermelha por PARSING,
      // não pelo veredito que ela mede.
      expect(shellParses(mutado)).toBe(true)
      writeHooksShim(dir, mutado)

      const r = commitUnderPty(dir, "s", { FASE_B_MARCA: marca })

      expect(r.status).toBe(0)
      expect(r.output).toContain(COMPLETOU)
      expect(commitObjects(dir)).toBe(1)
      expect(committedContent(dir, "scripts/quebrado.sh")).toBe(SH_EM_LF)
    },
  )

  it.skipIf(!PTY.available)("a fase que passa na SEGUNDA medição deixa o commit ENTRAR", () => {
    // A marca vive FORA do repo do fixture: um arquivo a mais na árvore não
    // pode virar parte do que se mede.
    const marca = join(tempDir("fase-b-marca-"), "marca")
    const dir = repoDaFaseB(marca)
    stage(dir, "scripts/quebrado.sh", SH_COM_CRLF)

    const r = commitUnderPty(dir, "s", { FASE_B_MARCA: marca })

    // A pergunta aconteceu, o remédio remendou — e a fase, remedida com o
    // remendo no índice, passou: é a PROVA de que a reexecução existe (sem ela
    // o hook sairia com o status da primeira medição e nada seria commitado).
    expect(r.meta?.saw_expect).toBe(true)
    expect(r.status).toBe(0)
    expect(r.output).toContain(COMPLETOU)
    expect(commitObjects(dir)).toBe(1)
    expect(headExists(dir)).toBe(true)
    // O que o commit GRAVOU é o corpo remendado — o `git add` do remédio é o
    // que levou o remendo ao commit, não uma escrita no disco.
    expect(committedContent(dir, "scripts/quebrado.sh")).toBe(SH_EM_LF)
  })
})

// ── o CONTROLE do fixture: o hook sabe commitar ──────────────────────────

describe.skipIf(!PTY.available)("o controle do fixture", () => {
  it("com o corpo fechado o commit ENTRA pelo git (sob o terminal, sem pergunta)", () => {
    const dir = repo()
    stage(dir, WORKFLOW, WORKFLOW_VALIDO)

    const r = commitUnderPty(dir)

    // Sem pergunta (não há cicatriz) e com o hook atravessando as fases: é o que
    // distingue "o commit foi bloqueado pelo defeito" de "o fixture não sabe
    // commitar" — o par de metades que o repositório exige de toda prova.
    expect(r.meta?.saw_expect).toBe(false)
    expect(r.status).toBe(0)
    expect(r.output).toContain(COMPLETOU)
    expect(commitObjects(dir)).toBe(1)
    expect(committedContent(dir, WORKFLOW)).toBe(WORKFLOW_VALIDO)
  })

  it("o remédio DIRETO também não pergunta com o corpo fechado (nada a remendar)", () => {
    // O outro lado do controle, pelo caminho interativo: sem cicatriz o remédio
    // nem pergunta — e sai 0 dizendo que não havia o que remendar.
    const dir = repo()
    stage(dir, WORKFLOW, WORKFLOW_VALIDO)

    const r = remedyUnderPty(dir, "s")

    expect(r.meta?.saw_expect).toBe(false)
    expect(r.status).toBe(0)
    expect(r.output).toContain("nada a remendar")
  })
})

/** O conteúdo que o ÍNDICE carrega (`git show :path`) — o que o commit grava. */
function committedContentIndex(dir: string, rel: string): string {
  const r = spawnSync("git", ["show", `:${rel}`], { cwd: dir, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git show :${rel} falhou: ${r.stderr ?? ""}`)
  return r.stdout ?? ""
}
