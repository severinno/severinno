/**
 * scan-cures-contract.test.ts - o CONTRATO DE FORMA da classe 'CURE'
 * (2026-08-11, sec 11.56 do gates-proofs.md).
 *
 * WHY THIS SUITE EXISTS: o repo tem 3 classes de erro com CURE - o
 * integrity lock (sec 8.5/8.6, `CURE: rm -rf node_modules && bun install
 * --frozen-lockfile`), o exit-claims (sec 11.54, EXIT_CLAIMS_CURE) e o
 * stash do ci-proof-run (sec 11.44). A regra dos 2 usos manda que a string
 * de cura seja compartilhada entre TODOS os pontos de erro da MESMA classe
 * - mas nada pina isso. Um dev que adicione um 2o ponto de erro a uma
 * classe e COLE o literal (em vez de importar a const) criaria a classe de
 * drift que a sec 11.54 matou - e nenhum teste falharia. ESTE suite pina a
 * regra como CONTRATO DE FORMA:
 *
 *   - INVARIANTE: toda string CURE (o literal do comando, nas formas
 *     `CURE:` e `CURE (...):`) aparece como LITERAL em EXATAMENTE 1 arquivo
 *     de scripts/*.mjs. Dois arquivos com o MESMO literal = duplicacao =
 *     drift = falha. A forma correta para 2+ pontos e a const exportada
 *     consumida POR REFERENCIA (o padrao da 11.54: o guard imprime
 *     `${EXIT_CLAIMS_CURE}` sem re-escrever o texto).
 *   - INVENTARIO PINADO: as 3 classes atuais (integrity / exit-claims /
 *     stash) com seus literais e arquivos donos - o pino vivo: uma 4a
 *     classe ou um literal movido quebra o REAL-REPO.
 *   - COMPARTILHADO POR CONSTRUCAO (o ACHADO da sondagem): o integrity e
 *     invocado de 2 lugares (batch runner via import L68 + pre-push via
 *     spawn L74) mas AMBOS executam o MESMO script - o literal vive num
 *     unico arquivo, nao ha 2 GERADORES fisicos do texto. A regra dos 2
 *     usos extrai const quando ha 2+ geradores do TEXTO (CLI + guard da
 *     11.54), nao 2 invocacoes do mesmo gerador.
 *   - MUTATION: o MESMO literal em 2 arquivos sinteticos e flagrado pelo
 *     extrator (a classe de drift como teste, nao prosa).
 *
 * SCOPE (test-only, OUT OF SHAPE como o FRONTIERS da sec 11.40): sem
 * manifest --print* nem CLI - o contrato e forma pura sobre a superficie
 * scripts/*.mjs, sem consumidor runtime. Registrado como tal na sec 11.56.
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { cleanupTempDirs, createTempDir } from "./golden-copy-utils"

const ROOT = process.cwd()
const SCRIPTS = path.join(ROOT, "scripts")

/**
 * O padrao do comando CURE dentro de um literal: `CURE:` ou `CURE (...):`
 * (a forma do stash da sec 11.44: `CURE (sec 11.44): ...`). O colon e o
 * discriminador: o pointer da sec 11.55 (`stale nao tem CURE de
 * registrar`) NAO casa (sem colon apos CURE) - ele e uma desambiguacao,
 * nao um comando de cura.
 */
const CURE_CMD = /CURE(?:\s*\([^)]*\))?\s*:/

/** Literais de string: aspas duplas (uma linha) + template literal (multilinha). */
const STRING_LIT = /"([^"\n]*)"|`([^`]*)`/g

/** Normaliza o literal para agrupar (remove interpolacoes ${...}, colapsa espacos). */
function normalize(s: string): string {
  return s.replace(/\$\{[^}]*\}/g, "{}").replace(/\s+/g, " ").trim()
}

/**
 * Varre os *.mjs de um diretorio e devolve os pares (arquivo, texto do
 * literal CURE) - o detector do contrato. SOH literais de string: a mencao
 * da CURE do integrity em comentario (ex.: o JSDoc do EXIT_CLAIMS_CURE cita
 * `CURE: rm -rf node_modules...`) NAO e literal e NAO conta - o contrato e
 * sobre onde o comando E IMPRESSO, nao sobre onde e documentado.
 */
export function scanCureLiterals(rootDir: string): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = []
  const files = fs
    .readdirSync(rootDir)
    .filter((f) => f.endsWith(".mjs"))
    .sort()
  for (const f of files) {
    const content = fs.readFileSync(path.join(rootDir, f), "utf8")
    for (const m of content.matchAll(STRING_LIT)) {
      const raw = m[1] ?? m[2] ?? ""
      if (CURE_CMD.test(raw)) out.push({ file: f, text: normalize(raw) })
    }
  }
  return out
}

/** Agrupa os pares por texto normalizado: texto -> arquivos que o imprimem. */
export function groupByText(pairs: Array<{ file: string; text: string }>): Map<string, string[]> {
  const byText = new Map<string, string[]>()
  for (const { file, text } of pairs) {
    const arr = byText.get(text) ?? []
    arr.push(file)
    byText.set(text, arr)
  }
  return byText
}

/** Os literais duplicados (mesmo texto em 2+ arquivos) - a classe de drift. */
export function duplicatedCures(pairs: Array<{ file: string; text: string }>): Array<[string, string[]]> {
  return [...groupByText(pairs).entries()].filter(([, files]) => files.length > 1)
}

afterEach(() => {
  cleanupTempDirs()
})

describe("scripts/scan-cures-contract.test.ts - o contrato de forma dos CUREs (sec 11.56)", () => {
  it("INVARIANTE REAL-REPO: nenhum literal CURE aparece em 2+ arquivos de scripts/*.mjs (a duplicacao e a classe de drift - 2+ pontos exigem const compartilhada por referencia, o padrao da 11.54)", () => {
    const pairs = scanCureLiterals(SCRIPTS)
    const dup = duplicatedCures(pairs)
    expect(dup).toEqual([])
    // sanity: o extrator NAO e vazio (pelo menos as 3 classes atuais).
    expect(groupByText(pairs).size).toBeGreaterThanOrEqual(3)
  }, 60000)

  it("INVENTARIO PINADO REAL-REPO: as 3 classes atuais com seus literais e arquivos donos (uma 4a classe ou literal movido quebra)", () => {
    const pairs = scanCureLiterals(SCRIPTS)
    // 1. Integrity lock (sec 8.5/8.6): literal no script dono.
    expect(
      pairs.some(
        (p) => p.file === "check-node-modules-integrity.mjs" && p.text.includes("CURE: rm -rf node_modules"),
      ),
    ).toBe(true)
    // 2. Exit-claims (sec 11.54): literal da const no scan-exit-claims.mjs.
    expect(
      pairs.some(
        (p) => p.file === "scan-exit-claims.mjs" && p.text.includes("CURE: registre a claim no EXIT_CLAIMS"),
      ),
    ).toBe(true)
    // 3. Stash do ci-proof-run (sec 11.44): a forma `CURE (...):`.
    expect(
      pairs.some((p) => p.file === "ci-proof-run.mjs" && p.text.includes("CURE (sec 11.44)")),
    ).toBe(true)
    // O guard do push NAO tem literal proprio - ele referencia a const por NOME.
    expect(pairs.some((p) => p.file === "check-exit-claims-push.mjs")).toBe(false)
  }, 60000)

  it("COMPARTILHADO POR REFERENCIA REAL-REPO: o guard do push usa EXIT_CLAIMS_CURE sem re-escrever o texto (a forma correta para 2+ pontos de erro - sec 11.54)", () => {
    const guard = fs.readFileSync(path.join(SCRIPTS, "check-exit-claims-push.mjs"), "utf8")
    expect(guard).toContain("EXIT_CLAIMS_CURE")
    expect(guard).not.toContain('"CURE:')
  }, 60000)

  it("MUTATION hermetico: o MESMO literal CURE em 2 arquivos -> o extrator flagra a duplicacao (a classe de drift como teste, nao prosa)", () => {
    const dir = createTempDir("cures-contract-")
    const dup = 'const CURE = "CURE: rm -rf node_modules && bun install --frozen-lockfile"'
    fs.writeFileSync(path.join(dir, "a.mjs"), dup, "utf8")
    fs.writeFileSync(path.join(dir, "b.mjs"), dup, "utf8")
    const dupFound = duplicatedCures(scanCureLiterals(dir))
    expect(dupFound).toHaveLength(1)
    expect(dupFound[0][1].sort()).toEqual(["a.mjs", "b.mjs"])

    // O controle: 1 arquivo com o literal -> sem duplicacao (o literal unico
    // e a forma valida da classe single-generator, como o integrity).
    const dir2 = createTempDir("cures-contract-")
    fs.writeFileSync(path.join(dir2, "a.mjs"), dup, "utf8")
    expect(duplicatedCures(scanCureLiterals(dir2))).toEqual([])
  }, 60000)
})
