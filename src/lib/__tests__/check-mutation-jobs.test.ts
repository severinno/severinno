/**
 * check-mutation-jobs.test.ts
 *
 * Testes unitários das funções PURAS de scripts/check-mutation-jobs.mjs:
 * extração de refs a scripts de mutation test de workflows (run: single-line
 * e bloco, mapeamento bun run → package.json), de matrizes de orquestração
 * (SUBTESTS/SCENARIOS, sem falsos positivos de comentários), e a cobertura
 * TRANSITIVA (checkMutationJobs) — o contrato "todo mutation test tem job".
 *
 * Cobre:
 *   - extractWorkflowRunRefs: `bash scripts/test-mutation-X.sh` em run:
 *     single-line; `run: |` em bloco (seed-guards style); `bun run
 *     test:mutation-X` mapeado via package.json scripts; comentários NÃO
 *     contam como cobertura
 *   - extractMatrixRefs: SUBTESTS/SCENARIOS lidos SÓ dentro do bloco
 *     `NOME=( ... )` — comentários do header que citam os mesmos scripts não
 *     geram cobertura falsa
 *   - computeCoverage/checkMutationJobs: cobertura transitiva (master →
 *     readme-guards → anchors/toc/images), script órfão (forward), ref de
 *     matriz quebrada (reverse), e a regressão REAL do repo
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-mutation-jobs.test.ts
 */

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  extractWorkflowRunRefs,
  extractMatrixRefs,
  computeCoverage,
  checkMutationJobs,
  parseDiffAddedMutationScripts,
  checkStagedMutationJobs,
} from "../../../scripts/check-mutation-jobs.mjs"

// ── Fixtures (parciais e suficientes para as funções puras) ──────────────

const WORKFLOW_SINGLE = `jobs:
  mutation-guards:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Mutation tests
        run: bash scripts/test-mutation-guards.sh
      - name: Summary
        run: echo "OK"
`

const WORKFLOW_BLOCK = `jobs:
  mutation-seed-dev-e2e:
    runs-on: ubuntu-latest
    steps:
      - name: Run mutation test
        run: |
          bun run test:mutation-seed-dev-e2e --skip-docker
          echo "  ✅ Mutation test passou"
`

const WORKFLOW_COMMENT_ONLY = `jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Summary
        # um comentário cita o script — NÃO é cobertura
        run: echo "usa scripts/test-mutation-ghost.sh? não"
`

const PKG_SCRIPTS = {
  "test:mutation-seed-dev-e2e": "bash scripts/test-mutation-seed-dev-e2e.sh",
  "test:mutation-guards": "bash scripts/test-mutation-guards.sh",
}

const MASTER_MATRIX = `SUBTESTS=(
  "bun-literal|Bun — literal bun-version em workflow|scripts/test-mutation-bun-literal.sh"
  "bun-removal|Bun --staged — remoção do input bun-version|scripts/test-mutation-bun-removal.sh"
  "hooks-symmetry|Hooks — guard novo no pre-commit|scripts/test-mutation-hooks-symmetry.sh"
  "readme|README — anchors + toc + images (matriz aninhada)|scripts/test-mutation-readme-guards.sh"
  "utf8-scope|UTF-8 — call site sem src/|scripts/test-mutation-utf8-scope.sh"
)
`

const README_MATRIX = `SCENARIOS=(
  "anchors|Anchors — heading renomeado|scripts/test-mutation-readme-anchors.sh"
  "toc|TOC — parágrafo→heading antes do índice|scripts/test-mutation-readme-toc.sh"
  "images|Images — count-pin derivado|scripts/test-mutation-readme-images.sh"
)
`

const MATRIX_WITH_COMMENTS = `# Matriz de sub-tests (id|descrição|script granular):
#   bun-literal    → scripts/test-mutation-bun-literal.sh
#   ghost          → scripts/test-mutation-ghost.sh   (comentário, NÃO conta)
SUBTESTS=(
  "bun-literal|Bun — literal|scripts/test-mutation-bun-literal.sh"
)
`

// ── Fixtures para o modo --staged (diff de git) ──────────────────────────

/** Diff com arquivo NOVO test-mutation-ghost.sh (new file mode). */
const DIFF_NEW_SCRIPT = `diff --git a/scripts/test-mutation-ghost.sh b/scripts/test-mutation-ghost.sh
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/scripts/test-mutation-ghost.sh
@@ -0,0 +1,3 @@
+#!/usr/bin/env bash
+echo hi
`

/** Diff que MODIFICA um script existente (SEM new file mode) — não é novo. */
const DIFF_MODIFIED_ONLY = `diff --git a/scripts/test-mutation-guards.sh b/scripts/test-mutation-guards.sh
index 123..456 100644
--- a/scripts/test-mutation-guards.sh
+++ b/scripts/test-mutation-guards.sh
@@ -1,2 +1,3 @@
 SUBTESTS=(
   "real|Real|scripts/test-mutation-real.sh"
+  "ghost|Ghost|scripts/test-mutation-ghost.sh"
 )
`

/** Diff com arquivo NOVO que NÃO é de mutation test (scripts/foo.sh). */
const DIFF_NEW_NON_MUTATION = `diff --git a/scripts/foo.sh b/scripts/foo.sh
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/scripts/foo.sh
@@ -0,0 +1,2 @@
+echo hi
`

// ── extractWorkflowRunRefs ───────────────────────────────────────────────

describe("extractWorkflowRunRefs", () => {
  it("extrai refs de run: single-line (pr-check style)", () => {
    const refs = extractWorkflowRunRefs(WORKFLOW_SINGLE)
    expect(refs).toEqual(["test-mutation-guards.sh"])
  })

  it("extrai refs de run: em bloco (|) e mapeia bun run via package.json", () => {
    const refs = extractWorkflowRunRefs(WORKFLOW_BLOCK, PKG_SCRIPTS)
    expect(refs).toEqual(["test-mutation-seed-dev-e2e.sh"])
  })

  it("NÃO trata comentário que cita script como cobertura", () => {
    const refs = extractWorkflowRunRefs(WORKFLOW_COMMENT_ONLY, PKG_SCRIPTS)
    expect(refs).toEqual([])
  })

  it("não mapeia bun run sem entrada correspondente em package.json", () => {
    const refs = extractWorkflowRunRefs(WORKFLOW_BLOCK, {})
    expect(refs).toEqual([])
  })
})

// ── extractMatrixRefs ────────────────────────────────────────────────────

describe("extractMatrixRefs", () => {
  it("lê a matriz SUBTESTS do master (5 scripts)", () => {
    const refs = extractMatrixRefs(MASTER_MATRIX, "SUBTESTS")
    expect(refs).toContain("test-mutation-bun-literal.sh")
    expect(refs).toContain("test-mutation-bun-removal.sh")
    expect(refs).toContain("test-mutation-hooks-symmetry.sh")
    expect(refs).toContain("test-mutation-readme-guards.sh")
    expect(refs).toContain("test-mutation-utf8-scope.sh")
    expect(refs).toHaveLength(5)
  })

  it("lê a matriz SCENARIOS aninhada (anchors + toc + images)", () => {
    const refs = extractMatrixRefs(README_MATRIX, "SCENARIOS")
    expect(refs).toEqual([
      "test-mutation-readme-anchors.sh",
      "test-mutation-readme-toc.sh",
      "test-mutation-readme-images.sh",
    ])
  })

  it("NÃO conta comentários do header que citam os mesmos scripts", () => {
    // o comentário cita test-mutation-ghost.sh — só o bloco SUBTESTS=(...)
    // deve render 1 ref real
    const refs = extractMatrixRefs(MATRIX_WITH_COMMENTS, "SUBTESTS")
    expect(refs).toEqual(["test-mutation-bun-literal.sh"])
  })

  it("retorna vazio quando o array não existe no conteúdo", () => {
    expect(extractMatrixRefs("SCENARIOS=(\n)", "SUBTESTS")).toEqual([])
  })
})

// ── computeCoverage / checkMutationJobs ──────────────────────────────────

describe("checkMutationJobs", () => {
  it("passa com cobertura transitiva completa (master → readme-guards → leafs)", () => {
    const scripts = [
      "test-mutation-guards.sh",
      "test-mutation-bun-literal.sh",
      "test-mutation-bun-removal.sh",
      "test-mutation-hooks-symmetry.sh",
      "test-mutation-readme-guards.sh",
      "test-mutation-readme-anchors.sh",
      "test-mutation-readme-toc.sh",
      "test-mutation-readme-images.sh",
      "test-mutation-utf8-scope.sh",
    ]
    const matrixRefs = {
      "test-mutation-guards.sh": extractMatrixRefs(MASTER_MATRIX, "SUBTESTS"),
      "test-mutation-readme-guards.sh": extractMatrixRefs(README_MATRIX, "SCENARIOS"),
    }
    const violations = checkMutationJobs({
      scripts,
      directRefs: ["test-mutation-guards.sh"],
      matrixRefs,
    })
    expect(violations).toEqual([])
  })

  it("falha com mutation script órfão (forward) — o caso do drift", () => {
    const scripts = ["test-mutation-guards.sh", "test-mutation-novo-guard.sh"]
    const violations = checkMutationJobs({
      scripts,
      directRefs: ["test-mutation-guards.sh"],
      matrixRefs: {},
    })
    expect(violations.length).toBe(1)
    expect(violations[0]).toContain("test-mutation-novo-guard.sh")
    expect(violations[0]).toContain("SEM job correspondente")
  })

  it("falha com ref de matriz quebrada (reverse): script citado não existe", () => {
    const scripts = ["test-mutation-guards.sh"]
    const violations = checkMutationJobs({
      scripts,
      directRefs: ["test-mutation-guards.sh"],
      matrixRefs: {
        "test-mutation-guards.sh": ["test-mutation-fantasma.sh"],
      },
    })
    expect(violations.length).toBe(1)
    expect(violations[0]).toContain("test-mutation-fantasma.sh")
    expect(violations[0]).toContain("NÃO existe em scripts/")
  })

  it("falha com ref de WORKFLOW quebrada (reverse): run: direto referencia script inexistente", () => {
    // par fechado: além da matriz, um run: de workflow que invoca um script
    // removido/renomeado (arquivo fantasma) também deve falhar.
    const scripts = ["test-mutation-guards.sh"]
    const violations = checkMutationJobs({
      scripts,
      directRefs: ["test-mutation-guards.sh", "test-mutation-wf-fantasma.sh"],
      matrixRefs: {},
    })
    expect(violations.length).toBe(1)
    expect(violations[0]).toContain("test-mutation-wf-fantasma.sh")
    expect(violations[0]).toContain("workflow referencia")
    expect(violations[0]).toContain("NÃO existe em scripts/")
  })

  it("reporta refs quebradas de workflow E de matriz juntas (par em ambos os lados)", () => {
    const scripts = ["test-mutation-guards.sh"]
    const violations = checkMutationJobs({
      scripts,
      directRefs: ["test-mutation-guards.sh", "test-mutation-wf-fantasma.sh"],
      matrixRefs: {
        "test-mutation-guards.sh": ["test-mutation-matriz-fantasma.sh"],
      },
    })
    expect(violations.length).toBe(2)
    expect(
      violations.some(
        (v) => v.includes("workflow referencia") && v.includes("test-mutation-wf-fantasma.sh"),
      ),
    ).toBe(true)
    expect(
      violations.some(
        (v) =>
          v.includes("matriz de 'test-mutation-guards.sh'") &&
          v.includes("test-mutation-matriz-fantasma.sh"),
      ),
    ).toBe(true)
  })

  it("NÃO gera violação quando ref de workflow aponta para script existente (par fechado — sem falso positivo)", () => {
    const scripts = ["test-mutation-guards.sh", "test-mutation-real.sh"]
    const violations = checkMutationJobs({
      scripts,
      directRefs: ["test-mutation-guards.sh", "test-mutation-real.sh"],
      matrixRefs: {},
    })
    expect(violations).toEqual([])
  })

  it("cobertura transitiva: master cobre readme-guards que cobre anchors/toc/images", () => {
    const scripts = ["test-mutation-readme-anchors.sh"]
    const matrixRefs = {
      "test-mutation-guards.sh": ["test-mutation-readme-guards.sh"],
      "test-mutation-readme-guards.sh": ["test-mutation-readme-anchors.sh"],
    }
    const { covered, uncovered } = computeCoverage({
      scripts,
      directRefs: ["test-mutation-guards.sh"],
      matrixRefs,
    })
    expect(covered.has("test-mutation-readme-guards.sh")).toBe(true)
    expect(covered.has("test-mutation-readme-anchors.sh")).toBe(true)
    expect(uncovered).toEqual([])
  })
})

// ── Modo --staged: parseDiffAddedMutationScripts ─────────────────────────

describe("parseDiffAddedMutationScripts", () => {
  it("extrai o nome do test-mutation-*.sh NOVO de um diff (new file mode)", () => {
    const scripts = parseDiffAddedMutationScripts(DIFF_NEW_SCRIPT)
    expect(scripts).toEqual(["test-mutation-ghost.sh"])
  })

  it("modificação de script EXISTENTE (sem new file mode) NÃO é 'novo'", () => {
    expect(parseDiffAddedMutationScripts(DIFF_MODIFIED_ONLY)).toEqual([])
  })

  it("arquivo novo que NÃO é test-mutation-*.sh é ignorado", () => {
    expect(parseDiffAddedMutationScripts(DIFF_NEW_NON_MUTATION)).toEqual([])
  })

  it("diff vazio → lista vazia", () => {
    expect(parseDiffAddedMutationScripts("")).toEqual([])
  })
})

// ── Modo --staged: checkStagedMutationJobs ───────────────────────────────

describe("checkStagedMutationJobs", () => {
  const coveredState = {
    scripts: ["test-mutation-guards.sh", "test-mutation-real.sh", "test-mutation-ghost.sh"],
    directRefs: ["test-mutation-guards.sh"], // master coberto diretamente
    matrixRefs: {
      "test-mutation-guards.sh": ["test-mutation-real.sh", "test-mutation-ghost.sh"],
    },
  }

  it("script NOVO sem cobertura (nem direta nem na matriz) → violação", () => {
    const state = {
      scripts: ["test-mutation-guards.sh", "test-mutation-real.sh", "test-mutation-ghost.sh"],
      directRefs: ["test-mutation-guards.sh"],
      matrixRefs: { "test-mutation-guards.sh": ["test-mutation-real.sh"] },
    }
    const violations = checkStagedMutationJobs(DIFF_NEW_SCRIPT, state)
    expect(violations.length).toBe(1)
    expect(violations[0]).toContain("test-mutation-ghost.sh")
    expect(violations[0]).toContain("SEM job correspondente")
  })

  it("script NOVO wireado na matriz no MESMO diff → sem violação", () => {
    const violations = checkStagedMutationJobs(DIFF_NEW_SCRIPT, coveredState)
    expect(violations).toEqual([])
  })

  it("diff sem script novo (modificação) → sem violação", () => {
    expect(checkStagedMutationJobs(DIFF_MODIFIED_ONLY, coveredState)).toEqual([])
  })

  it("diff vazio → sem violação", () => {
    expect(checkStagedMutationJobs("", coveredState)).toEqual([])
  })
})

// ── Regressão REAL do repo (ground truth) ────────────────────────────────

describe("checkMutationJobs — regressão real do repo", () => {
  it("todo scripts/test-mutation-*.sh do repo real tem job (directo ou via matriz)", () => {
    const cwd = process.cwd()
    const scriptsDir = join(cwd, "scripts")
    const workflowsDir = join(cwd, ".github", "workflows")
    const pkgScripts = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).scripts ?? {}

    const scripts = readdirSync(scriptsDir)
      .filter((f) => f.startsWith("test-mutation-") && f.endsWith(".sh"))
      .sort()

    const directRefs = new Set<string>()
    for (const wf of readdirSync(workflowsDir)) {
      if (!/\.ya?ml$/i.test(wf)) continue
      for (const ref of extractWorkflowRunRefs(
        readFileSync(join(workflowsDir, wf), "utf8"),
        pkgScripts,
      )) {
        directRefs.add(ref)
      }
    }

    const matrixRefs: Record<string, string[]> = {}
    for (const [name, arrayName] of [
      ["test-mutation-guards.sh", "SUBTESTS"],
      ["test-mutation-readme-guards.sh", "SCENARIOS"],
    ]) {
      const p = join(scriptsDir, name)
      const content = readFileSync(p, "utf8") // orquestradores sempre existem no repo
      matrixRefs[name] = extractMatrixRefs(content, arrayName)
    }

    // o master deve estar coberto DIRETAMENTE (pr-check roda bash
    // scripts/test-mutation-guards.sh) — sem isso nada transitivo valeria
    expect(directRefs.has("test-mutation-guards.sh")).toBe(true)
    // seed-dev-e2e coberto diretamente pelo seed-guards (bun run → package.json)
    expect(directRefs.has("test-mutation-seed-dev-e2e.sh")).toBe(true)

    const violations = checkMutationJobs({ scripts, directRefs: [...directRefs], matrixRefs })
    expect(violations).toEqual([])
  })
})
