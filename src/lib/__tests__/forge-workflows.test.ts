/**
 * forge-workflows.test.ts
 *
 * Testes do módulo FONTE ÚNICA dos diretórios de forja.
 *
 * POR QUE existe: os guards do repositório cravavam `.github/workflows` no
 * escopo. Quando a forja self-hosted (Gitea/Forgejo) virou DONA DO MERGE, a
 * pipeline que decide o merge ficou fora da cobertura de 14 guards de uma vez —
 * e o resultado observado foi `BUN_VERSION: "1.4.0"` literal,
 * `oven-sh/setup-bun@v2` em 6 call sites e `check:ts-nocheck` ausente, sem um
 * único guard reclamar. Este módulo é a única declaração de "quais forjas
 * existem"; o teste trava a lista e os helpers que os guards consomem.
 *
 * Execução focada:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/forge-workflows.test.ts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  FORGE_ACTIONS_DIRS,
  FORGE_WORKFLOW_DIRS,
  GITEA_WORKFLOW_DIR,
  GITHUB_WORKFLOW_DIR,
  allWorkflowFiles,
  existingWorkflowDirs,
  isForgeWorkflowDir,
  isForgeWorkflowPath,
  workflowFileNames,
} from "../../../scripts/forge-workflows.mjs"

/** Cria uma árvore temporária de arquivos e devolve a raiz. */
function fixture(tree: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "forge-wf-"))
  for (const [rel, content] of Object.entries(tree)) {
    const full = join(root, rel)
    mkdirSync(join(full, ".."), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

function withFixture<T>(tree: Record<string, string>, fn: (root: string) => T): T {
  const root = fixture(tree)
  try {
    return fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe("declaração das forjas", () => {
  it("declara GitHub e Gitea/Forgejo", () => {
    expect(FORGE_WORKFLOW_DIRS).toContain(GITHUB_WORKFLOW_DIR)
    expect(FORGE_WORKFLOW_DIRS).toContain(GITEA_WORKFLOW_DIR)
  })

  it("o array é construído a partir das constantes nomeadas (sem divergir)", () => {
    expect([...FORGE_WORKFLOW_DIRS]).toEqual([GITHUB_WORKFLOW_DIR, GITEA_WORKFLOW_DIR])
  })

  it("as constantes são os caminhos canônicos", () => {
    expect(GITHUB_WORKFLOW_DIR).toBe(".github/workflows")
    expect(GITEA_WORKFLOW_DIR).toBe(".gitea/workflows")
  })

  it("ações locais: `.github/actions` (o Gitea resolve do workspace)", () => {
    expect(FORGE_ACTIONS_DIRS).toContain(".github/actions")
  })
})

describe("existingWorkflowDirs", () => {
  it("devolve só as forjas presentes no checkout (ausência não é violação)", () => {
    withFixture({ [join(GITHUB_WORKFLOW_DIR, "ci.yml")]: "on: push\n" }, (root) => {
      expect(existingWorkflowDirs(root)).toEqual([GITHUB_WORKFLOW_DIR])
    })
  })

  it("devolve as duas quando ambas existem", () => {
    withFixture(
      {
        [join(GITHUB_WORKFLOW_DIR, "ci.yml")]: "on: push\n",
        [join(GITEA_WORKFLOW_DIR, "ci.yml")]: "on: push\n",
      },
      (root) => {
        expect(existingWorkflowDirs(root)).toEqual([GITHUB_WORKFLOW_DIR, GITEA_WORKFLOW_DIR])
      },
    )
  })

  it("nenhuma forja presente → lista vazia", () => {
    withFixture({ "package.json": "{}" }, (root) => {
      expect(existingWorkflowDirs(root)).toEqual([])
    })
  })
})

describe("workflowFileNames", () => {
  it("mantém apenas .yml/.yaml e ordena (o allowlist dos guards usa o basename)", () => {
    withFixture(
      {
        [join(GITHUB_WORKFLOW_DIR, "zeta.yml")]: "a",
        [join(GITHUB_WORKFLOW_DIR, "alpha.yaml")]: "a",
        [join(GITHUB_WORKFLOW_DIR, "README.md")]: "a",
      },
      (root) => {
        expect(workflowFileNames(root, GITHUB_WORKFLOW_DIR)).toEqual(["alpha.yaml", "zeta.yml"])
      },
    )
  })

  it("diretório ausente → lista vazia", () => {
    withFixture({ "package.json": "{}" }, (root) => {
      expect(workflowFileNames(root, GITEA_WORKFLOW_DIR)).toEqual([])
    })
  })
})

describe("allWorkflowFiles", () => {
  it("rotula cada arquivo com o diretório da forja (é o que dá atribuição à violação)", () => {
    withFixture(
      {
        [join(GITHUB_WORKFLOW_DIR, "pr-check.yml")]: "a",
        [join(GITEA_WORKFLOW_DIR, "ci.yml")]: "a",
      },
      (root) => {
        expect(allWorkflowFiles(root).map((w) => w.path)).toEqual([
          ".github/workflows/pr-check.yml",
          ".gitea/workflows/ci.yml",
        ])
      },
    )
  })
})

describe("isForgeWorkflowPath / isForgeWorkflowDir", () => {
  it("reconhece workflow de qualquer forja", () => {
    expect(isForgeWorkflowPath(".gitea/workflows/ci.yml")).toBe(true)
    expect(isForgeWorkflowPath(".github/workflows/pr-check.yml")).toBe(true)
    expect(isForgeWorkflowPath("scripts/ci.yml")).toBe(false)
    expect(isForgeWorkflowPath(".gitea/workflows/README.md")).toBe(false)
  })

  it("distingue DIRETÓRIO (proibido cravar) de arquivo (permitido)", () => {
    expect(isForgeWorkflowDir(".gitea/workflows")).toBe(true)
    expect(isForgeWorkflowDir(".gitea/workflows/ci.yml")).toBe(false)
  })
})

describe("repositório real", () => {
  const ROOT = process.cwd()

  it("as duas forjas existem e são varridas (a dona do merge não pode ficar de fora)", () => {
    expect(existingWorkflowDirs(ROOT)).toEqual([GITHUB_WORKFLOW_DIR, GITEA_WORKFLOW_DIR])
    const paths = allWorkflowFiles(ROOT).map((w) => w.path)
    expect(paths).toContain(".gitea/workflows/ci.yml")
    expect(paths).toContain(".gitea/workflows/required-checks-drift.yml")
    expect(paths).toContain(".github/workflows/pr-check.yml")
  })
})
