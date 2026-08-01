/**
 * check-seed-hooks.test.ts
 *
 * Testes unitários das funções PURAS do scripts/check-seed-hooks.mjs (guard
 * fail-closed que impede SEED_SPEC_PATCH/PROD_SEED_ALLOW_DEV de vazarem para
 * workflows de produção).
 *
 * Cobre:
 *   - findSeedHookUses: ignora comentários/linhas vazias, detecta ambos os
 *     hooks, reporta número de linha correto
 *   - checkWorkflowFile: allowlist de teste passa, qualquer outro workflow
 *     com hook falha (fail-closed — inclusive workflows NOVOS)
 *   - scanWorkflows: múltiplos arquivos, mescla violações com nome do arquivo
 */

import { describe, it, expect } from "vitest"
import {
  findSeedHookUses,
  checkWorkflowFile,
  scanWorkflows,
} from "../../../scripts/check-seed-hooks.mjs"

const DEPLOY_WITH_HOOK = `name: Deploy

jobs:
  migrate:
    steps:
      - name: Run seed
        env:
          PROD_SEED_ALLOW_DEV: "1"
        run: bun run db:seed:prod
`

describe("findSeedHookUses", () => {
  it("ignora linhas vazias e comentários", () => {
    const content = `
# SEED_SPEC_PATCH é usado nos E2Es
  # comentário indentado com PROD_SEED_ALLOW_DEV

    run: echo "sem hook"
`
    expect(findSeedHookUses(content)).toEqual([])
  })

  it("detecta SEED_SPEC_PATCH em linha de env", () => {
    const content = `steps:
  - name: Run seed
    env:
      SEED_SPEC_PATCH: '[{"name":"Elétrica","icon":"bolt"}]'
`
    const uses = findSeedHookUses(content)
    expect(uses).toHaveLength(1)
    expect(uses[0]).toMatchObject({ line: 4, hook: "SEED_SPEC_PATCH" })
  })

  it("detecta PROD_SEED_ALLOW_DEV em linha de env", () => {
    const content = `jobs:
  migrate:
    env:
      PROD_SEED_ALLOW_DEV: "1"
`
    const uses = findSeedHookUses(content)
    expect(uses).toHaveLength(1)
    expect(uses[0]).toMatchObject({ line: 4, hook: "PROD_SEED_ALLOW_DEV" })
  })

  it("reporta ambos os hooks com linhas corretas", () => {
    const content = `env:
  SEED_SPEC_PATCH: "x"
run: |
  PROD_SEED_ALLOW_DEV=1 bun prisma/seed.ts
`
    const uses = findSeedHookUses(content)
    expect(uses).toHaveLength(2)
    expect(uses[0]).toMatchObject({ line: 2, hook: "SEED_SPEC_PATCH" })
    expect(uses[1]).toMatchObject({ line: 4, hook: "PROD_SEED_ALLOW_DEV" })
  })

  it("não confunde hooks com nomes parecidos (word-boundary)", () => {
    const content = `run: |
  echo "SEED_SPEC_PATCH2 não é o hook"
  echo "PROD_SEED_ALLOW_DEV_EXTRA também não"
  export SEED_SPEC_PATCH="{x}"
`
    // Regex com word-boundary: SEED_SPEC_PATCH2 / PROD_SEED_ALLOW_DEV_EXTRA
    // NÃO casam (são substrings maiores); apenas o hook exato casa.
    const uses = findSeedHookUses(content)
    expect(uses).toHaveLength(1)
    expect(uses[0]).toMatchObject({ line: 4, hook: "SEED_SPEC_PATCH" })
  })
})

describe("checkWorkflowFile", () => {
  it("workflow de teste no allowlist passa mesmo com hooks", () => {
    for (const name of ["seed-guards.yml", "pr-check.yml", "benchmark-weekly.yml", "ci.yml"]) {
      expect(checkWorkflowFile(name, DEPLOY_WITH_HOOK), `${name} no allowlist`).toEqual([])
    }
  })

  it("deploy.yml com hook falha (fail-closed)", () => {
    const violations = checkWorkflowFile("deploy.yml", DEPLOY_WITH_HOOK)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ file: "deploy.yml", hook: "PROD_SEED_ALLOW_DEV" })
  })

  it("release-deploy.yml com hook falha (fail-closed)", () => {
    const violations = checkWorkflowFile("release-deploy.yml", DEPLOY_WITH_HOOK)
    expect(violations).toHaveLength(1)
    expect(violations[0].file).toBe("release-deploy.yml")
  })

  it("workflow NOVO (não no allowlist) com hook falha — protege contra futuros pipelines de prod", () => {
    const violations = checkWorkflowFile("prod-bootstrap.yml", DEPLOY_WITH_HOOK)
    expect(violations).toHaveLength(1)
    expect(violations[0].file).toBe("prod-bootstrap.yml")
  })

  it("workflow fora do allowlist SEM hooks passa", () => {
    expect(checkWorkflowFile("deploy.yml", "name: Deploy\njobs: {}\n")).toEqual([])
  })
})

describe("scanWorkflows", () => {
  it("mescla violações de múltiplos arquivos com nome do arquivo", () => {
    const files = [
      { name: "deploy.yml", content: DEPLOY_WITH_HOOK },
      { name: "seed-guards.yml", content: DEPLOY_WITH_HOOK }, // allowlist → ignorado
      { name: "release-deploy.yml", content: "run: |\n  SEED_SPEC_PATCH=1 bun seed.ts\n" },
    ]
    const violations = scanWorkflows(files)
    expect(violations).toHaveLength(2)
    expect(violations.map((v) => v.file)).toEqual(["deploy.yml", "release-deploy.yml"])
  })

  it("lista vazia → sem violações", () => {
    expect(scanWorkflows([])).toEqual([])
  })

  it("arquivo vazio → sem violações", () => {
    expect(scanWorkflows([{ name: "deploy.yml", content: "" }])).toEqual([])
  })
})
