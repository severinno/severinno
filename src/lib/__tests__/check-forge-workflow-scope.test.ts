/**
 * check-forge-workflow-scope.test.ts
 *
 * Testes do guard META que impede cravar um diretório de forja nos scripts.
 *
 * POR QUE existe: o buraco não foi um bug pontual, foi uma CLASSE — 14 guards
 * com `.github/workflows` cravado no escopo, e a pipeline dona do merge ficando
 * fora da cobertura de todos eles de uma vez. Corrigir os 14 resolve o sintoma;
 * este guard resolve a classe.
 *
 * O teste trava as duas direções:
 *   - cravar o DIRETÓRIO é violação (é o que faz um guard varrer uma forja só);
 *   - referenciar um ARQUIVO específico é permitido (há guards legitimamente
 *     sobre UM workflow), inclusive montado por `join(..., "...", "arquivo")`.
 *
 * Execução focada:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-forge-workflow-scope.test.ts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  EXEMPT,
  SELF,
  SOURCE_OF_TRUTH,
  findScopeViolations,
  hardcodedForgeDir,
  isCommentLine,
} from "../../../scripts/check-forge-workflow-scope.mjs"

/** Cria `scripts/` temporário com os arquivos dados e varre. */
function scan(tree: Record<string, string>): string[] {
  const root = mkdtempSync(join(tmpdir(), "forge-scope-"))
  try {
    const dir = join(root, "scripts")
    mkdirSync(dir, { recursive: true })
    for (const [name, content] of Object.entries(tree)) writeFileSync(join(dir, name), content)
    return findScopeViolations(dir)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe("isCommentLine", () => {
  it("reconhece comentários de JS/módulo (`//`, `/*`, `*`, `#`)", () => {
    expect(isCommentLine("  // .github/workflows")).toBe(true)
    expect(isCommentLine("   * .gitea/workflows")).toBe(true)
    expect(isCommentLine("  # .github/workflows")).toBe(true)
  })

  it("não confunde código com comentário", () => {
    expect(isCommentLine('const dir = ".github/workflows"')).toBe(false)
  })
})

describe("hardcodedForgeDir", () => {
  it("reprova o literal do DIRETÓRIO", () => {
    expect(hardcodedForgeDir('const d = ".github/workflows"')).toContain(".github/workflows")
    expect(hardcodedForgeDir('{ dir: ".gitea/workflows" }')).toContain(".gitea/workflows")
  })

  it("reprova o caminho montado por segmentos quando termina no diretório", () => {
    expect(hardcodedForgeDir('join(root, ".gitea", "workflows")')).toContain("segmentos")
  })

  it("PERMITE referência a um ARQUIVO específico (diretório + arquivo)", () => {
    expect(hardcodedForgeDir('const f = ".github/workflows/pr-check.yml"')).toBeNull()
    expect(hardcodedForgeDir('join(root, ".gitea", "workflows", "ci.yml")')).toBeNull()
  })

  it("ignora linhas sem diretório de forja", () => {
    expect(hardcodedForgeDir("const d = FORGE_WORKFLOW_DIRS")).toBeNull()
  })
})

describe("findScopeViolations", () => {
  it("reprova o script que crava o diretório", () => {
    const v = scan({ "check-x.mjs": 'const d = ".gitea/workflows"\n' })
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("check-x.mjs:1")
    // A mensagem precisa ENSINAR o conserto e explicar o custo da falha.
    expect(v[0]).toContain("forge-workflows.mjs")
    expect(v[0]).toContain("fora da cobertura")
  })

  it("aprova o script que importa a fonte única", () => {
    expect(
      scan({
        "check-x.mjs":
          'import { existingWorkflowDirs } from "./forge-workflows.mjs"\nfor (const d of existingWorkflowDirs(cwd)) {}\n',
      }),
    ).toEqual([])
  })

  it("não conta a prosa: comentário citando o diretório não é violação", () => {
    expect(scan({ "check-x.mjs": '// varria só ".github/workflows" até 09/2026\n' })).toEqual([])
  })

  it("isenta o módulo da fonte única (é quem PODE declarar os diretórios)", () => {
    expect(scan({ [SOURCE_OF_TRUTH]: 'export const A = ".gitea/workflows"\n' })).toEqual([])
  })

  it("isenta o próprio guard, com razão registrada", () => {
    expect(EXEMPT.has(SELF)).toBe(true)
    expect(scan({ [SELF]: 'const d = ".gitea/workflows"\n' })).toEqual([])
  })

  it("aponta TODOS os arquivos infratores, não só o primeiro", () => {
    const v = scan({
      "check-a.mjs": 'const d = ".github/workflows"\n',
      "check-b.mjs": 'const d = ".gitea/workflows"\n',
    })
    expect(v).toHaveLength(2)
  })
})

describe("repositório real", () => {
  it("nenhum script crava um diretório de forja", () => {
    expect(findScopeViolations(join(process.cwd(), "scripts"))).toEqual([])
  })
})
