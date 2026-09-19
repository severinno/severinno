/**
 * pre-commit-remedy-pipefail.test.ts
 *
 * A prova da SEXTA classe do remédio do pre-commit — `pipefail-sigpipe`, a que
 * entrou na oferta quando o guard dono passou a rodar no hook (fase B). O que
 * este arquivo mede, e por quê:
 *
 *   1. A CLASSE ESTÁ NA OFERTA e o fixer dela cita o guard dono — a descoberta
 *      valida isso, mas o par (declaração ↔ `--fix` do dono) é a premissa de
 *      tudo abaixo: sem ele a classe sai da oferta em silêncio e a cicatriz volta
 *      a ser consertada à mão;
 *   2. A DETECÇÃO é a do guard DONO (o `fixAll` importado), não uma segunda
 *      leitura: o veredito do CLI do guard contra o MESMO fixture tem de bater
 *      com o que a classe relata (aqui a régua não mora na classe);
 *   3. O REMENDO CHEGA AO ÍNDICE — o "sim" troca `PRODUTOR | grep -q PADRAO` por
 *      `grep -q PADRAO <<< "$PRODUTOR"` na árvore E no blob do commit;
 *   4. O "NÃO" NÃO TOCA EM NADA (nem árvore, nem índice);
 *   5. FAIL-CLOSED: um arquivo do escopo que a varredura não conseguiu LER faz a
 *      rodada sair UNAVAILABLE — "não li" nunca vira "nada a remendar";
 *   6. O HOOK RODA O GUARD — a metade que torna a classe ALCANÇÁVEL: com a
 *      cicatriz no índice o hook bloqueia e a oferta do remédio NOMEIA o fixer
 *      dela; e a MUTAÇÃO (a linha do guard fora do hook) prova que é essa linha
 *      que separa o commit bloqueado do commit que passa com a cicatriz dentro.
 *
 * O fixture é um repositório git de VERDADE (o `--staged` do gate e o índice da
 * classe leem o índice do git, não uma lista em memória), e o hook da última
 * metade é o ARQUIVO REAL do repositório, somado pelo dublê da casa com o guard
 * desta classe no `passthrough` (os irmãos de fase devolvem 0 — eles não são o
 * assunto, e um hook que falhasse por "script não encontrado" provaria nada).
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/pre-commit-remedy-pipefail.test.ts
 */

import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

import { afterAll, describe, expect, it } from "vitest"

import { EXIT } from "../../../scripts/check-workflow-run-syntax.mjs"
import { CLASSES, remedy } from "../../../scripts/pre-commit-remedy.mjs"
import {
  COMPLETOU,
  cleanupFixtures,
  novoRepo as novoRepoSim,
  resolveBash,
  shellParses,
  stage,
} from "../../../scripts/hook-simulator.mjs"
import { HOOK_SOURCE, novoRepo as novoRepoDoHook, runHook } from "./helpers/pre-commit-fixture"

afterAll(() => {
  cleanupFixtures()
})

const ROOT = resolve(__dirname, "..", "..", "..")
const CLASSE = "pipefail-sigpipe"
const GUARD = "check-pipefail-sigpipe.mjs"
const SCRIPT = "scripts/com-cicatriz.sh"

/** O contexto da detecção: só a classe da sintaxe usa o `bash`; o resto ignora. */
const CTX = { bash: resolveBash() }

/** A cicatriz: `| grep -q` sob `set -o pipefail` (a classe SIGPIPE). */
const COM_CICATRIZ =
  "#!/usr/bin/env bash\n" +
  "set -euo pipefail\n" +
  "OUT=$(echo oi)\n" +
  'echo "$OUT" | grep -q oi && echo achou\n'

/** O MESMO script depois do remédio — o que o `--fix` do dono escreve. */
const SEM_CICATRIZ =
  "#!/usr/bin/env bash\n" +
  "set -euo pipefail\n" +
  "OUT=$(echo oi)\n" +
  'grep -q oi <<< "$OUT" && echo achou\n'

/** A manchete do guard dono quando há ocorrência (o que o hook imprime). */
const MANCHETE = "ocorrência(s) de `| grep -q`"

/** O "sim" e o "não" injetados: o caminho interativo sem depender de um terminal. */
const SIM = { askFn: async () => "s" }
const NAO = { askFn: async () => "n" }

/**
 * Um repositório git de verdade, com `scripts/` (o fecho é VAZIO: estas medições
 * não spawnam guard nenhum — a régua da classe é o `fixAll` importado do dono).
 */
function repo() {
  return novoRepoSim({ prefix: "remedy-pipefail-", wrapper: "set -eu\n", closure: [] })
}

function git(dir: string, args: string[]) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", input: "" })
  return { status: r.status, out: String(r.stdout ?? "") }
}

/** O conteúdo do ÍNDICE (o que o commit gravaria). */
function indice(dir: string, rel: string) {
  const r = spawnSync("git", ["show", `:${rel}`], { cwd: dir, input: "" })
  if (r.status !== 0) throw new Error(`git show :${rel} falhou: ${String(r.stderr)}`)
  return r.stdout.toString("utf8")
}

/** O relatório que o remédio escreveu (o log inteiro, para as asserções). */
function dito() {
  const linhas: string[] = []
  return { log: (m: string) => linhas.push(m), linhas }
}

const classe = () => CLASSES.find((c) => c.id === CLASSE)

// ── 1. a classe está na oferta, e o dono é quem remenda ──────────────────

describe("a classe `pipefail-sigpipe` (a oferta derivada)", () => {
  it("entra na oferta pela DESCOBERTA, na ordem declarada", () => {
    expect(CLASSES.map((c) => c.id)).toContain(CLASSE)
    expect(classe()?.ordem).toBeGreaterThan(0)
  })

  it("o fixer cita o guard DONO, e o dono declara `--fix` (o par declarado é real)", () => {
    const c = classe()
    expect(c?.script).toBe(GUARD)
    expect(c?.fixer).toContain(`scripts/${GUARD}`)
    expect(readFileSync(join(ROOT, "scripts", GUARD), "utf8")).toContain("--fix")
  })

  it("o caminho à mão leva o remendo ao COMMIT (o `--fix` sozinho remenda a árvore)", () => {
    const linhas = classe()?.sugere([SCRIPT]) ?? []
    expect(linhas.join("\n")).toContain(`node scripts/${GUARD} --fix`)
    expect(linhas.join("\n")).toContain(`git add ${SCRIPT}`)
  })
})

// ── 2. a detecção é a do guard dono ──────────────────────────────────────

describe("a DETECÇÃO é a régua do guard dono (nada é reimplementado na classe)", () => {
  it("a cicatriz no índice: a classe lista o arquivo e o ANTES/DEPOIS da reescrita", () => {
    const dir = repo()
    stage(dir, SCRIPT, COM_CICATRIZ)

    const d = classe()?.detectar(dir, CTX)
    expect(d?.offenders).toEqual([SCRIPT])
    expect(d?.violacoes).toBe(1)
    expect(d?.semRemendo).toBeNull()
    expect(d?.relatorio).toContain("pipe quieto sob pipefail")
    expect(d?.relatorio).toContain('echo "$OUT" | grep -q oi')
    expect(d?.relatorio).toContain('grep -q oi <<< "$OUT"')
  })

  it("o MESMO fixture no CLI do guard dono sai 1 — as duas leituras concordam", () => {
    const dir = repo()
    stage(dir, SCRIPT, COM_CICATRIZ)
    const r = spawnSync(process.execPath, [join(ROOT, "scripts", GUARD), "--root", dir], {
      encoding: "utf8",
    })
    expect(r.status).toBe(EXIT.VIOLATIONS)
    expect(`${r.stdout ?? ""}${r.stderr ?? ""}`).toContain("| grep -q")
  })

  it("o script JÁ remendado não tem ofensor nem violação (o verde não é por omissão)", () => {
    const dir = repo()
    stage(dir, SCRIPT, SEM_CICATRIZ)
    const d = classe()?.detectar(dir, CTX)
    expect(d?.offenders).toEqual([])
    expect(d?.violacoes).toBe(0)
    expect(d?.indisponivel).toBeUndefined()
  })
})

// ── 3 e 4. o remendo chega ao índice; o "não" não toca em nada ───────────

describe("o remédio do pre-commit oferece e leva o remendo ao COMMIT", () => {
  it('o "sim" troca o pipe pelo herestring NA ÁRVORE e NO ÍNDICE', async () => {
    const dir = repo()
    stage(dir, SCRIPT, COM_CICATRIZ)

    const r = await remedy(dir, { ...SIM, ...dito() })

    expect(r.code).toBe(EXIT.OK)
    // O `remedy()` devolve `classes: object[]` (o driver não conhece a classe por
    // tipo): o id é lido do que a rodada aplicou, e o teste o NOMEIA aqui.
    const aplicadas = (r.classes as { id: string }[]).map((c) => c.id)
    expect(aplicadas).toContain(CLASSE)
    expect(r.restaged).toContain(SCRIPT)
    expect(indice(dir, SCRIPT)).toBe(SEM_CICATRIZ)
    expect(readFileSync(join(dir, SCRIPT), "utf8")).toBe(SEM_CICATRIZ)
    // A revalidação é a do guard dono: zero violações depois do remendo.
    expect(classe()?.detectar(dir, CTX)?.violacoes).toBe(0)
  })

  it('o "não" deixa árvore E índice intactos', async () => {
    const dir = repo()
    stage(dir, SCRIPT, COM_CICATRIZ)

    const r = await remedy(dir, { ...NAO, ...dito() })

    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(r.restaged).toEqual([])
    expect(indice(dir, SCRIPT)).toBe(COM_CICATRIZ)
    expect(readFileSync(join(dir, SCRIPT), "utf8")).toBe(COM_CICATRIZ)
  })

  it("o relatório da oferta nomeia a CLASSE e o que o remendo vai fazer", async () => {
    const dir = repo()
    stage(dir, SCRIPT, COM_CICATRIZ)
    const { log, linhas } = dito()

    await remedy(dir, { ...NAO, log })

    const texto = linhas.join("\n")
    expect(texto).toContain(`\`${CLASSE}\``)
    expect(texto).toContain('echo "$OUT" | grep -q oi')
    expect(texto).toContain('grep -q oi <<< "$OUT"')
  })
})

// ── 5. fail-closed: "não li" nunca vira "nada a remendar" ────────────────

describe("o que a varredura NÃO conseguiu ler", () => {
  it("um `.sh` que não decodifica sai UNAVAILABLE, com o arquivo NOMEADO", async () => {
    const dir = repo()
    writeFileSync(
      join(dir, SCRIPT),
      Buffer.concat([Buffer.from("#!/usr/bin/env bash\nset -euo pipefail\n"), Buffer.from([0xff])]),
    )
    git(dir, ["add", SCRIPT])
    const { log, linhas } = dito()

    const r = await remedy(dir, { ...SIM, log })

    expect(r.code).toBe(EXIT.UNAVAILABLE)
    expect(r.restaged).toEqual([])
    expect(linhas.join("\n")).toContain(SCRIPT)
    expect(linhas.join("\n")).toContain("NÃO conseguiu ler")
  })
})

// ── 6. a ALCANÇABILIDADE: o hook roda o guard, e é isso que oferece ──────

describe("o hook REAL bloqueia pela classe (e é a linha dele que oferece o remédio)", () => {
  const hookRepo = () =>
    novoRepoDoHook({ passthrough: ["check-pipefail-sigpipe"], prefix: "pre-commit-pipefail-" })

  it("CONTROLE: script já remendado no índice ⇒ o hook chega ao fim", () => {
    const dir = hookRepo()
    stage(dir, SCRIPT, SEM_CICATRIZ)

    const r = runHook(dir)

    expect(r.status).toBe(0)
    expect(r.output).toContain(COMPLETOU)
  })

  it("com a cicatriz o hook bloqueia E a oferta do remédio NOMEIA o fixer da classe", () => {
    const dir = hookRepo()
    stage(dir, SCRIPT, COM_CICATRIZ)

    const r = runHook(dir)

    // O guard dono no caminho (o veredito é dele, com a manchete dele)...
    expect(r.status).not.toBe(0)
    expect(r.output).toContain(MANCHETE)
    expect(r.output).not.toContain(COMPLETOU)
    // ...e o REMÉDIO alcançou a classe: sem o guard no hook ela nunca seria
    // oferecida neste momento (é a metade que este arquivo existe para prender).
    expect(r.output).toContain(`\`${CLASSE}\``)
    expect(r.output).toContain(`node scripts/${GUARD} --fix`)
  })

  it("MUTAÇÃO: sem a chamada ao guard no hook, o commit com a cicatriz PASSA", () => {
    const mutante = HOOK_SOURCE.replace("node scripts/check-pipefail-sigpipe.mjs &", "true &")
    // A mutação NÃO pode quebrar o parsing do hook: um não-zero (ou um verde) por
    // erro de sintaxe mediria o mutante, não o veredito.
    expect(mutante).not.toBe(HOOK_SOURCE)
    expect(shellParses(mutante)).toBe(true)

    const dir = hookRepo()
    stage(dir, SCRIPT, COM_CICATRIZ)

    const r = runHook(dir, mutante)

    // O defeito passa: nada mais nesta fase o acusa (os irmãos de fase são dublês
    // que devolvem 0), então a classe deixa de ser alcançável — a prova de que a
    // linha que entrou no hook é LOAD-BEARING, e não decorativa.
    expect(r.status).toBe(0)
    expect(r.output).toContain(COMPLETOU)
    expect(r.output).not.toContain(`node scripts/${GUARD} --fix`)
  })
})
