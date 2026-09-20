/**
 * pre-commit-compose-arg-removal-blocks.test.ts
 *
 * Prova, EXECUTANDO o arquivo real do hook `.husky/pre-commit`, que o commit que
 * **REMOVE o `BUN_VERSION` de um build site de compose** é recusado — medindo a
 * régua onde o hook a mede (o `--staged` do `check-bun-mirror`, que compara o
 * bloco do ÍNDICE com o de HEAD).
 *
 * O BURACO QUE ESTA PROVA FECHA: o recorte das linhas ADICIONADAS julga os blocos
 * que o diff TOCA, e um bloco que só PERDE uma linha não ganha linha adicionada
 * nenhuma. Remover o arg de um build site passava pelo commit e só encontrava a
 * varredura GLOBAL — que roda no PR, quando roda. Era a mesma cegueira do defeito
 * original da invariante 18(b), na direção oposta: o build site deixava de ter
 * valor escrito, e "nenhum valor" não aparece em nenhuma linha nova.
 *
 * O que a prova monta (e o que ela NÃO monta):
 *
 *   - o hook é o ARQUIVO REAL, somado, então a fase, a agregação (`wait_all`) e a
 *     linha de comando são as de produção;
 *   - o repositório é um `git init` de verdade, com o estado BASE COMITADO (o HEAD
 *     de que a remoção sai — sem ele não há "bloco anterior" com que comparar) e o
 *     defeito `git add`ado: o recorte lê o índice de verdade (`git diff --cached`
 *     + `git show :path` + `git show HEAD:path`), o que um fixture em memória não
 *     reproduziria;
 *   - o guard do Bun roda com o `node` REAL (o fecho transitivo já o copia — ele é
 *     a régua do que é um COMPOSE para o guard de sintaxe), então o veredito é do
 *     guard de verdade e não de um dublê dele.
 *
 * O que é DUBLÊ, e por quê: os irmãos de fase (que não são o assunto) devolvem 0
 * por função no wrapper. Quem impede que o dublê esconda um falso positivo é o
 * CONTROLE: com o arg no lugar, o hook sai 0 **e** imprime a manchete do guard no
 * modo `--staged` — se o guard não rodasse de verdade, não haveria manchete.
 *
 * A MESMA régua (repositório, dublê, fecho) é a de
 * `pre-commit-run-syntax-blocks.test.ts` / `pre-commit-git-commit-blocks.test.ts`:
 * aqui ela é pedida com `passthrough: [BUN_GUARD]`, e nada muda no fixture dos
 * irmãos (um guard a mais rodando de verdade reprovaria controles que não são o
 * assunto deles).
 *
 * O SEGUNDO ASSUNTO deste arquivo é o que a fase A vermelha faz com a OFERTA do
 * remédio, e ele vive aqui porque é este fixture que produz uma fase A vermelha de
 * VERDADE (o guard do Bun reprovando o recorte do índice), sem dublê do veredito:
 *
 *   - a oferta é das CLASSES PRESENTES no commit, não do gate que reprovou: com a
 *     fase A vermelha e uma classe remendável no MESMO índice (a do SIGPIPE, que
 *     vive na fase B — e também a `bun-mirror-removal`, que remenda o PRÓPRIO
 *     defeito da fase A), o remédio é oferecido igual — e o veredito que bloqueia
 *     continua sendo o da fase;
 *   - a MUTAÇÃO que devolve o hook ao estado do HEAD (`[ "$FASE_A" -eq 0 ] || exit`
 *     antes da oferta) mostra o que o operador PERDIA: com o gate sem fixer
 *     encerrando o hook, o remédio da classe que estava no índice nunca era
 *     oferecido;
 *   - depois de um remédio VERDE, as fases que estavam VERMELHAS são rodadas de
 *     novo e o veredito é delas — a fase A incluída (sem a reexecução, um remédio
 *     verde faz o commit PASSAR por cima de um gate vermelho);
 *   - e a fase B que a fase A vermelha deixou SEM MEDIÇÃO é medida depois do
 *     remédio, para nenhuma fase ficar sem veredito (o estado "um fixer da fase A
 *     existe" tem hoje um caso REAL — a `bun-mirror-removal` cobre o guard do
 *     índice, e é ela que este arquivo vê sendo oferecida no MESMO commit da fase
 *     A vermelha; a SIMULAÇÃO por mutação do ramo segue valendo para o caso de um
 *     fixer da fase A declarado por um guard ainda SEM classe).
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/pre-commit-compose-arg-removal-blocks.test.ts
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  COMPLETOU,
  REPO_ROOT,
  cleanupFixtures,
  headExists,
  shellParses,
  stage,
} from "@/lib/__tests__/helpers/hook-simulator"
import {
  BUN_GUARD,
  BUN_GUARD_COMMAND,
  HOOK_SOURCE,
  REMEDY_STUB_ENV,
  novoRepo,
  runCommit,
  runHook,
} from "@/lib/__tests__/helpers/pre-commit-fixture"
import { NO_PROMPT_ENV } from "../../../scripts/pre-commit-remedy.mjs"

afterAll(() => {
  cleanupFixtures()
})

// ── o fixture ────────────────────────────────────────────────────────────
//
// O espelho declarado (`.actrc`) entra porque o guard compara por VALOR: sem ele
// toda menção seria violação por "nenhum espelho declara a versão", e o
// CONTROLE mediria outra coisa.

const ACTRC = "--var BUN_VERSION=1.3.14\n"
const DOCKERFILE = "Dockerfile.worker"
const COMPOSE = "docker-compose.yml"

const DOCKERFILE_FONTE = "ARG BUN_VERSION\nFROM oven/bun:${BUN_VERSION}\n"

/** O build site do fixture PASSANDO o arg (o estado do bloco em HEAD). */
const COMPOSE_COM_ARG = [
  "services:",
  "  web:",
  "    build:",
  "      context: .",
  `      dockerfile: ${DOCKERFILE}`,
  "      args:",
  "        BUN_VERSION: ${BUN_VERSION:-1.3.14}",
  "",
].join("\n")

/** O MESMO serviço, com o bloco sem o arg — o commit que o hook tem de recusar. */
const COMPOSE_SEM_ARG = COMPOSE_COM_ARG.split("\n").slice(0, 5).join("\n") + "\n"

/**
 * Um fixture com o estado BASE comitado e o hook do repositório disponível para
 * ser executado somado.
 *
 * O commit base vai com `--no-verify` de propósito: ele é a PREMISSA da medição
 * (o "antes" com o arg), e um base que já dependesse do veredito do hook mediria
 * outra coisa.
 */
function repoComBase(extra: string[] = []) {
  const dir = novoRepo({
    passthrough: [BUN_GUARD, ...extra],
    prefix: "pre-commit-compose-arg-",
  })
  stage(dir, ".actrc", ACTRC)
  stage(dir, DOCKERFILE, DOCKERFILE_FONTE)
  stage(dir, COMPOSE, COMPOSE_COM_ARG)
  const base = runCommit(dir, {}, ["commit", "-q", "-m", "base do fixture", "--no-verify"])
  expect(base.status).toBe(0)
  expect(headExists(dir)).toBe(true)
  return dir
}

// ── premissa ─────────────────────────────────────────────────────────────

describe("a premissa do harness", () => {
  it("o hook chama o guard do Bun com --staged, e o fixture torna esse comando real", () => {
    expect(HOOK_SOURCE).toContain(BUN_GUARD_COMMAND)
    expect(existsSync(join(REPO_ROOT, "scripts", BUN_GUARD))).toBe(true)
  })

  it("o fecho copiado traz o guard do Bun e o resolvedor da fonte única", () => {
    // Sem o fecho, o guard morreria com "module not found" e o não-zero do hook
    // seria do FIXTURE, não do defeito (o falso positivo clássico).
    const dir = repoComBase()
    expect(existsSync(join(dir, "scripts", BUN_GUARD))).toBe(true)
    expect(existsSync(join(dir, "scripts", "bun-version.mjs"))).toBe(true)
  })
})

// ── o hook real ──────────────────────────────────────────────────────────

describe("o hook real recusa o commit que REMOVE o arg do build site", () => {
  it("CONTROLE: o arg no lugar ⇒ exit 0, o hook termina e o guard RODOU", () => {
    const dir = repoComBase()
    stage(dir, COMPOSE, COMPOSE_COM_ARG) // mesma forma: o diff é vazio para o bloco

    const res = runHook(dir)

    // As duas metades: o hook atravessa tudo (0) E o guard real executou no modo
    // do índice. Sem a segunda, "0" poderia ser um hook que nunca chamou o guard.
    expect(res.status).toBe(0)
    expect(res.output).toContain(COMPLETOU)
    expect(res.output).toContain("Diff ok")
    expect(res.output).toContain("staged")
  }, 60_000)

  it("o arg REMOVIDO no índice ⇒ exit não-zero, nomeando arquivo, linha e serviço", () => {
    const dir = repoComBase()
    stage(dir, COMPOSE, COMPOSE_SEM_ARG)

    const res = runHook(dir)

    expect(res.status).not.toBe(0)
    expect(res.output).not.toContain(COMPLETOU) // o veredito da fase A encerra o hook
    expect(res.output).toContain(`${COMPOSE}:3`)
    expect(res.output).toContain("'web'")
    expect(res.output).toContain(DOCKERFILE)
    expect(res.output).toContain("REMOVE o arg do bloco")
    // ...mas o hook NÃO para ANTES da oferta: o remédio roda e OFERECE a classe
    // que cobre ESTE defeito — a `bun-mirror-removal`, cujo fixer é o `--fix` do
    // guard dono. Sem terminal (o harness não tem tty de controle) a oferta sai
    // como o caminho à mão, e o commit segue bloqueado. Parar antes — o
    // comportamento antigo — seria o que escondia a oferta das classes que o
    // mesmo índice carregasse.
    expect(res.output).toContain("bun-mirror-removal")
    expect(res.output).toContain("node scripts/check-bun-mirror.mjs --fix")
    expect(res.output).toContain("segue BLOQUEADO")
  }, 60_000)

  it("o defeito que SÓ o commit carrega (índice sem o arg, árvore com ele) bloqueia", () => {
    // É o caso que a árvore esconde: alguém re-adiciona o arg no editor e esquece
    // de `git add`. O commit leva a remoção; a árvore parece saudável.
    const dir = repoComBase()
    stage(dir, COMPOSE, COMPOSE_SEM_ARG)
    // A árvore volta a ter o arg (o índice fica como está).
    const caminho = join(dir, COMPOSE)
    const composto = readFileSync(caminho, "utf8")
    expect(composto).toBe(COMPOSE_SEM_ARG)
    writeFileSync(caminho, COMPOSE_COM_ARG, "utf8")

    const res = runHook(dir)

    expect(res.status).not.toBe(0)
    expect(res.output).toContain(`${COMPOSE}:3`)
  }, 60_000)

  it("o arquivo NOVO (sem HEAD com que comparar) não é julgado pela remoção", () => {
    // Num repositório sem o estado base, o compose entra pela PRIMEIRA vez: não
    // existe "bloco anterior" de onde o arg tenha saído, e a régua da remoção não
    // tem o que comparar. O veredito do arquivo novo continua sendo o de sempre
    // (o build site que passa o arg passa).
    const dir = novoRepo({ passthrough: [BUN_GUARD], prefix: "pre-commit-compose-novo-" })
    stage(dir, ".actrc", ACTRC)
    stage(dir, DOCKERFILE, DOCKERFILE_FONTE)
    stage(dir, COMPOSE, COMPOSE_COM_ARG) // primeiro commit: o arquivo é NOVO

    const res = runHook(dir)

    expect(res.status).toBe(0)
    expect(res.output).toContain(COMPLETOU)
  }, 60_000)
})

// ── a fase A vermelha e a OFERTA do remédio ──────────────────────────────
//
// O `if` da oferta carrega o veredito da FASE A: sem ele, o guard do índice que
// reprova é um gate SEM FIXER encerrando o hook — e o operador perde a oferta das
// classes que o MESMO commit carrega. Aqui a fase A vermelha é de verdade (o guard
// do Bun, real, sobre o recorte do índice) e a classe remendável é a do SIGPIPE
// (`PRODUTOR | grep -q` sob pipefail), que vive na FASE B — uma fase que a fase A
// vermelha nem chega a rodar. É o caso que o pedido descreve, medido por execução.

/** A cicatriz de SIGPIPE — a MESMA do teste da classe (`set -euo pipefail`). */
const CICATRIZ_SIGPIPE = "scripts/com-cicatriz.sh"
const CICATRIZ_SIGPIPE_FONTE =
  "#!/usr/bin/env bash\n" +
  "set -euo pipefail\n" +
  "OUT=$(echo oi)\n" +
  'echo "$OUT" | grep -q oi && echo achou\n'

/** O guard DONO da classe acima (o que o remédio cita no caminho à mão). */
const GUARD_SIGPIPE = "check-pipefail-sigpipe.mjs"

/** A manchete do guard dono quando há ocorrência (o veredito da fase B). */
const MANCHETE_SIGPIPE = "ocorrência(s) de `| grep -q`"

/** A manchete do REMÉDIO quando há classe remendável: é a OFERTA acontecendo. */
const OFERTA = "carrega defeito(s) MECÂNICO(s)"

/** O defeito da fase A como o operador o lê (o veredito do guard do Bun). */
const VEREDITO_FASE_A = "REMOVE o arg do bloco"

/**
 * As âncoras da transformação do hook, lidas do próprio texto dele: se o hook
 * reestruturar o bloco, a mutação tem de falhar ALTA (o teste da premissa abaixo
 * conta as ocorrências) em vez de virar no-op silencioso.
 */
const REEXECUCAO_A = '  if [ "$FASE_A" -ne 0 ]; then\n    fase_a\n  fi\n'
const REMEDICAO_B = '  if [ "$FASE_B_MEDIDA" -eq 0 ]; then\n    fase_b\n  fi\n'

/** Onde o HEAD encerrava o hook: logo depois de medir o gate de sintaxe. */
const ESPERA_SINTAXE =
  'SINTAXE=0\nif [ -n "$PID_RUNSYNTAX" ]; then\n  wait "$PID_RUNSYNTAX" || SINTAXE=$?\nfi\n'
const SAIDA_ANTIGA = '\n[ "$FASE_A" -eq 0 ] || exit "$FASE_A"\n'

/**
 * O hook COMO ELE ESTAVA NO HEAD: o veredito da fase A encerrava o hook antes da
 * oferta. É a mutação do que o pedido corrige — e ela é a ÚNICA diferença entre
 * medir "a oferta acontece" e "a oferta era perdida".
 */
function hookComSaidaAntiga() {
  const mutado = HOOK_SOURCE.replace(ESPERA_SINTAXE, ESPERA_SINTAXE + SAIDA_ANTIGA)
  expect(mutado).not.toBe(HOOK_SOURCE)
  expect(shellParses(mutado)).toBe(true)
  return mutado
}

/** O hook com um fixer da fase A APLICADO (estado simulado, ver o describe). */
function hookComFixerDaFaseA() {
  const mutado = HOOK_SOURCE.replace(
    REEXECUCAO_A,
    '  if [ "$FASE_A" -ne 0 ]; then\n    true   # M: o remédio de um fixer da fase A foi aplicado\n  fi\n',
  )
  expect(mutado).not.toBe(HOOK_SOURCE)
  expect(shellParses(mutado)).toBe(true)
  return mutado
}

describe("a premissa da transformação", () => {
  it("o hook tem as âncoras UMA vez cada (uma emenda muda mede o hook, não o fixture)", () => {
    expect(HOOK_SOURCE.split(REEXECUCAO_A).length - 1).toBe(1)
    expect(HOOK_SOURCE.split(REMEDICAO_B).length - 1).toBe(1)
    expect(HOOK_SOURCE.split(ESPERA_SINTAXE).length - 1).toBe(1)
  })
})

describe("a fase A vermelha não engole a oferta: ela é das CLASSES do commit", () => {
  it("o remédio é oferecido mesmo com o veredito da fase A bloqueando o commit", () => {
    const dir = repoComBase()
    stage(dir, COMPOSE, COMPOSE_SEM_ARG) // a FASE A reprova (guard real)
    stage(dir, CICATRIZ_SIGPIPE, CICATRIZ_SIGPIPE_FONTE) // a CLASSE presente

    const res = runHook(dir)

    // O commit está bloqueado, e por quem reprovou: a fase A continua sendo o
    // veredito (ela não foi "levantada" pela oferta).
    expect(res.status).not.toBe(0)
    expect(res.output).not.toContain(COMPLETOU)
    expect(res.output).toContain(VEREDITO_FASE_A)
    // E a OFERTA aconteceu: o remédio rodou, achou a classe do SIGPIPE no MESMO
    // commit e publicou o caminho à mão dela — sem terminal, fail-closed.
    expect(res.output).toContain(OFERTA)
    expect(res.output).toContain(CICATRIZ_SIGPIPE)
    expect(res.output).toContain(`node scripts/${GUARD_SIGPIPE} --fix`)
    expect(res.output).toContain(NO_PROMPT_ENV)
  }, 60_000)

  it("MUTAÇÃO (o hook do HEAD): com a saída pela fase A, o veredito é o MESMO — e a oferta some", () => {
    // Esta é a diferença que o pedido compra: no hook antigo, o gate sem fixer
    // encerrava aqui — o remédio da classe que estava no índice nunca era
    // oferecido, e o operador consertava à mão o que a máquina remenda.
    //
    // As duas formas são medidas no MESMO fixture: assim o que se atribui à
    // mudança é a OFERTA, não o veredito (o exit code tem de ser igual — o
    // bloqueio continua sendo o da fase A nas duas).
    const comOferta = repoComBase()
    stage(comOferta, COMPOSE, COMPOSE_SEM_ARG)
    stage(comOferta, CICATRIZ_SIGPIPE, CICATRIZ_SIGPIPE_FONTE)
    const hoje = runHook(comOferta)

    const semOferta = repoComBase()
    stage(semOferta, COMPOSE, COMPOSE_SEM_ARG)
    stage(semOferta, CICATRIZ_SIGPIPE, CICATRIZ_SIGPIPE_FONTE)
    const res = runHook(semOferta, hookComSaidaAntiga())

    expect(res.status).toBe(hoje.status)
    expect(res.status).not.toBe(0)
    expect(hoje.output).toContain(OFERTA)
    expect(res.output).toContain(VEREDITO_FASE_A)
    expect(res.output).not.toContain(OFERTA) // a oferta era PERDIDA
    expect(res.output).not.toContain(`node scripts/${GUARD_SIGPIPE} --fix`)
  }, 60_000)
})

describe("depois de um remédio VERDE, o veredito é da fase rodada de novo", () => {
  it("o remédio verde não levanta a FASE A: o commit segue bloqueado", () => {
    const dir = repoComBase()
    stage(dir, COMPOSE, COMPOSE_SEM_ARG)

    const res = runHook(dir, HOOK_SOURCE, { [REMEDY_STUB_ENV]: "0" })

    expect(res.status).not.toBe(0)
    expect(res.output).not.toContain(COMPLETOU)
    // A fase A foi MEDIDA DUAS VEZES (a primeira e a reexecução): o veredito do
    // guard do Bun aparece duas vezes — é a medida de que a reexecução rodou.
    expect(res.output.split(VEREDITO_FASE_A).length - 1).toBe(2)
  }, 60_000)

  it("MUTAÇÃO: sem a reexecução da fase A, o remédio verde faz o commit PASSAR", () => {
    // O remédio só LEVANTA a falha que ele mediu; a fase que estava vermelha é
    // quem declara o veredito. Sem esta reexecução, um remédio verde — que não
    // tocou em nada do que a fase A mede — deixaria entrar um commit com o gate
    // do índice vermelho.
    const dir = repoComBase()
    stage(dir, COMPOSE, COMPOSE_SEM_ARG)

    const mutado = HOOK_SOURCE.replace(REEXECUCAO_A, "")
    expect(mutado).not.toBe(HOOK_SOURCE)
    expect(shellParses(mutado)).toBe(true)

    const res = runHook(dir, mutado, { [REMEDY_STUB_ENV]: "0" })

    expect(res.status).toBe(0)
    expect(res.output).toContain(COMPLETOU)
  }, 60_000)

  it("a fase B que ficou SEM MEDIÇÃO é medida depois do remédio (e é ela que bloqueia)", () => {
    // O estado medido aqui é SIMULADO — e declarado: hoje nenhuma classe remenda um
    // guard de fase A, então a reexecução dela nunca volta verde. A mutação abaixo
    // ("um fixer da fase A existe e o remédio o aplicou") é o dia em que voltar — e
    // é o ramo em que a fase B, PULADA porque a fase A reprovou, ficaria sem
    // veredito nenhum. Ela é remedida, reprova (o guard do SIGPIPE, real) e o hook
    // encerra com o código dela.
    const dir = repoComBase([GUARD_SIGPIPE])
    stage(dir, COMPOSE, COMPOSE_SEM_ARG) // a fase A reprova
    stage(dir, CICATRIZ_SIGPIPE, CICATRIZ_SIGPIPE_FONTE) // e a fase B também

    const res = runHook(dir, hookComFixerDaFaseA(), { [REMEDY_STUB_ENV]: "0" })

    expect(res.status).not.toBe(0)
    expect(res.output).not.toContain(COMPLETOU)
    // A fase B RODOU (a manchete é do guard dono, real, sobre o MESMO índice).
    expect(res.output).toContain(MANCHETE_SIGPIPE)
  }, 60_000)

  it("MUTAÇÃO: sem a remedição, o commit PASSA com a fase B nunca medida", () => {
    const dir = repoComBase([GUARD_SIGPIPE])
    stage(dir, COMPOSE, COMPOSE_SEM_ARG)
    stage(dir, CICATRIZ_SIGPIPE, CICATRIZ_SIGPIPE_FONTE)

    const semRemedicao = hookComFixerDaFaseA().replace(REMEDICAO_B, "")
    expect(semRemedicao).not.toBe(hookComFixerDaFaseA())
    expect(shellParses(semRemedicao)).toBe(true)

    const res = runHook(dir, semRemedicao, { [REMEDY_STUB_ENV]: "0" })

    expect(res.status).toBe(0)
    expect(res.output).toContain(COMPLETOU)
    expect(res.output).not.toContain(MANCHETE_SIGPIPE) // nunca medida
  }, 60_000)
})

// ── mutação ──────────────────────────────────────────────────────────────
//
// A mutação é aplicada onde o defeito é medido: no guard COPIADO do fixture (o
// repositório real nunca é tocado) e no hook somado.

describe("mutação: a remoção só é recusada porque o hook chama o guard, e o guard compara os blocos", () => {
  it("M1 — o hook deixa de CHAMAR o guard do Bun: o commit com a remoção passa", () => {
    const mutado = HOOK_SOURCE.replace(BUN_GUARD_COMMAND, "true &")
    expect(mutado).not.toBe(HOOK_SOURCE) // a mutação precisa aplicar de fato

    const dir = repoComBase()
    stage(dir, COMPOSE, COMPOSE_SEM_ARG)

    const res = runHook(dir, mutado)

    expect(res.status).toBe(0)
    expect(res.output).toContain(COMPLETOU)
  }, 60_000)

  it("M2 — o guard perde a comparação ÍNDICE×HEAD: a remoção passa pelo mesmo hook", () => {
    const dir = repoComBase()
    // A metade mutada é a REGISTRADA no recorte; o resto do guard segue igual.
    const caminho = join(dir, "scripts", BUN_GUARD)
    const fonte = readFileSync(caminho, "utf8")
    const mutada = fonte.replace(
      "...argsRemovidos.violations,",
      "// M2: a comparação ÍNDICE×HEAD cegada",
    )
    expect(mutada).not.toBe(fonte)
    writeFileSync(caminho, mutada, "utf8")

    stage(dir, COMPOSE, COMPOSE_SEM_ARG)
    const res = runHook(dir)

    expect(res.status).toBe(0)
    expect(res.output).toContain(COMPLETOU)
  }, 60_000)
})
