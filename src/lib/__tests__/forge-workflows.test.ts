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
  defaultsBlocks,
  defaultsRunLines,
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

// ─────────────────────────────────────────────────────────────────────────────
// `defaults: run: shell:` — a leitura é UMA, e ela decide o que NÃO é passo
//
// O defeito que estes testes travam: `defaults:` declara o shell do escopo, e a
// forma escalar (`defaults:\n  run: bash`) é lida por qualquer scanner de `run:`
// como um COMANDO. Não é ruído: `defaults:\n  run: node scripts/check-x.mjs`
// fazia o guard de paridade achar que a pipeline rodava um gate que ela não
// roda, e o doctor aceitar a declaração como o comando do job de merge.
// ─────────────────────────────────────────────────────────────────────────────

describe("defaultsBlocks — o shell default como FATO lido (workflow e job)", () => {
  const WF = [
    "name: x",
    "on: [push]",
    "defaults:",
    "  run:",
    "    shell: bash",
    "jobs:",
    "  guardas:",
    "    defaults:",
    "      run:",
    "        shell: bash -eo pipefail",
    "    steps:",
    "      - run: echo ok",
  ].join("\n")

  it("lê o escopo do ARQUIVO e o do JOB, com o nome do job", () => {
    expect(defaultsBlocks(WF)).toEqual([
      { scope: "workflow", job: null, shell: "bash", line: 5, runLine: 4, inline: false },
      {
        scope: "job",
        job: "guardas",
        shell: "bash -eo pipefail",
        line: 10,
        runLine: 9,
        inline: false,
      },
    ])
  })

  it("a forma em LINHA sai `unparsed` — não ler NÃO é o mesmo que não haver", () => {
    expect(defaultsBlocks("defaults: {run: {shell: pwsh}}\n")).toEqual([
      {
        scope: "workflow",
        job: null,
        shell: "{run: {shell: pwsh}}",
        line: 1,
        runLine: 1,
        inline: true,
        unparsed: true,
      },
    ])
  })

  it("valor escalar no `run:` sai `unparsed` (é a forma que vira passo fantasma)", () => {
    const [d] = defaultsBlocks("defaults:\n  run: bash\njobs:\n  a:\n    steps: []\n")
    expect(d).toMatchObject({ unparsed: true, shell: "bash", line: 2, runLine: 2 })
  })

  it("um `defaults:` sem `run:` não declara nada", () => {
    expect(defaultsBlocks("defaults:\n  foo: bar\n")).toEqual([])
  })

  it("workflow sem `defaults:` não inventa declaração", () => {
    expect(defaultsBlocks("jobs:\n  a:\n    steps:\n      - run: echo ok\n")).toEqual([])
  })
})

describe("defaultsRunLines — a declaração que nenhum guard pode ler como passo", () => {
  it("cobre a chave `run:` e os filhos diretos (`shell:`, `working-directory:`)", () => {
    const wf = [
      "name: x",
      "defaults:",
      "  run:",
      "    shell: bash",
      "    working-directory: /tmp",
      "jobs:",
      "  a:",
      "    steps:",
      "      - run: echo ok",
    ].join("\n")
    expect([...defaultsRunLines(wf)].sort((a, b) => a - b)).toEqual([3, 4, 5])
  })

  it("o passo do job NÃO entra (a declaração termina na primeira linha menos profunda)", () => {
    const wf = [
      "defaults:",
      "  run: bash",
      "jobs:",
      "  a:",
      "    defaults:",
      "      run: bash",
      "    steps:",
      "      - run: echo ok",
    ].join("\n")
    expect([...defaultsRunLines(wf)].sort((a, b) => a - b)).toEqual([2, 6])
  })

  it("a forma em LINHA é a própria declaração", () => {
    expect([...defaultsRunLines("defaults: {run: {shell: pwsh}}\n")]).toEqual([1])
  })

  it("sem `defaults:` é vazio (nenhum passo é engolido)", () => {
    expect(defaultsRunLines("jobs:\n  a:\n    steps:\n      - run: echo ok\n").size).toBe(0)
  })
})
