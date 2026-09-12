/**
 * check-no-setup-bun.test.ts
 *
 * Testes das funções PURAS do scripts/check-no-setup-bun.mjs — guard que
 * impede o RETORNO de oven-sh/setup-bun@v2 nos workflows (o action externo
 * re-downloada o release LATEST em todo job; o setup do projeto é
 * scripts/setup-bun-ci.sh, chamado por `run:` e com a versão vinda da fonte
 * única — o composite local que existiu no meio do caminho também saiu).
 *
 * Cobre:
 *   - findSetupBunRefs: detecta oven-sh/setup-bun em qualquer linha de uso,
 *     com número de linha; ignora comentários/linhas vazias
 *   - scanWorkflowDir: retorna por arquivo; diretório sem ocorrências → []
 */

import { describe, it, expect, afterAll } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findSetupBunRefs, scanWorkflowDir } from "../../../scripts/check-no-setup-bun.mjs"

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "no-setup-bun-"))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── findSetupBunRefs ─────────────────────────────────────────────────────

describe("findSetupBunRefs", () => {
  it("detecta uses: oven-sh/setup-bun@v2 com número de linha", () => {
    const content = `jobs:\n  check:\n    steps:\n      - uses: oven-sh/setup-bun@v2\n        with:\n          bun-version: latest\n`
    const refs = findSetupBunRefs(content)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ line: 4 })
    expect(refs[0].text).toContain("oven-sh/setup-bun")
  })

  it("detecta qualquer versão/tag do action (não só @v2)", () => {
    const content = `- uses: oven-sh/setup-bun@v1.0.0\n`
    const refs = findSetupBunRefs(content)
    expect(refs).toHaveLength(1)
  })

  it("detecta múltiplas ocorrências no mesmo arquivo", () => {
    const content = `- uses: oven-sh/setup-bun@v2\n- uses: oven-sh/setup-bun@v2\n`
    expect(findSetupBunRefs(content)).toHaveLength(2)
  })

  it("ignora linhas em branco e comentários", () => {
    const content = `# - uses: oven-sh/setup-bun@v2 (comentário)\n\n- run: echo ok\n`
    expect(findSetupBunRefs(content)).toEqual([])
  })

  it("não confunde action LOCAL (./...) com o action externo", () => {
    // Caso fixado de propósito: `./.github/actions/setup-bun` foi o composite
    // que o projeto usou (e que saiu para scripts/setup-bun-ci.sh). Se um dia
    // nascer de novo uma action local com esse nome, este guard NÃO pode
    // acusá-la — só o `uses: oven-sh/setup-bun` externo é regressão.
    const content = `- uses: ./.github/actions/setup-bun\n  with:\n    bun-version: \${{ vars.BUN_VERSION }}\n`
    expect(findSetupBunRefs(content)).toEqual([])
  })

  it("menção em prosa (nome de step) sem a key `uses:` não casa", () => {
    // Regressão do falso positivo real: o próprio step de guard tem o nome
    // 'Check no workflow uses oven-sh/setup-bun' — deve passar limpo.
    const content = `- name: Check no workflow uses oven-sh/setup-bun\n  run: node scripts/check-no-setup-bun.mjs\n`
    expect(findSetupBunRefs(content)).toEqual([])
  })
})

// ── scanWorkflowDir ──────────────────────────────────────────────────────

describe("scanWorkflowDir", () => {
  it("retorna refs agrupadas por arquivo", () => {
    const dir = makeDir()
    writeFileSync(join(dir, "a.yml"), `- uses: oven-sh/setup-bun@v2\n`)
    writeFileSync(join(dir, "b.yml"), `- uses: ./.github/actions/setup-bun\n`)
    const results = scanWorkflowDir(dir)
    expect(results).toHaveLength(1)
    expect(results[0].file).toBe("a.yml")
    expect(results[0].refs).toHaveLength(1)
  })

  it("diretório sem ocorrências → [] (inclui .yml com action local)", () => {
    const dir = makeDir()
    writeFileSync(join(dir, "ok.yml"), `- uses: ./.github/actions/setup-bun\n`)
    expect(scanWorkflowDir(dir)).toEqual([])
  })

  it("diretório vazio → []", () => {
    const dir = makeDir()
    expect(scanWorkflowDir(dir)).toEqual([])
  })
})
