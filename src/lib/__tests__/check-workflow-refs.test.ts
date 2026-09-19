/**
 * check-workflow-refs.test.ts
 *
 * Testes unitários das funções PURAS do scripts/check-workflow-refs.mjs (guard
 * fail-closed que detecta referências quebradas entre workflows e scripts/ +
 * package.json + reusable workflows locais).
 *
 * Cobre:
 *   - extractScriptRefs: invocações node/bash/bun scripts/X com número de linha,
 *     ignora comentários/linhas vazias/${{ }}, não casa menções em texto
 *   - extractPkgScriptRefs: bun|npm|pnpm|yarn run <entry>, não casa bunx/npx
 *   - extractWorkflowUses: uses: ./.github/workflows/X.yml
 *   - checkWorkflowFile: script ausente / entry ausente / workflow ausente /
 *     workflow sem on: workflow_call → violações; tudo resolvido → []
 *   - scanWorkflows: mescla múltiplos arquivos
 */

import { describe, it, expect } from "vitest"
import {
  extractScriptRefs,
  extractPkgScriptRefs,
  extractPkgScriptTarget,
  checkPkgInternalTargets,
  pkgEntryLine,
  extractWorkflowUses,
  extractActionUses,
  checkWorkflowFile,
  scanWorkflows,
} from "../../../scripts/check-workflow-refs.mjs"

// ── Fixtures ─────────────────────────────────────────────────────────────

/** Contexto com TODOS os artefatos resolvidos. */
function makeCtx(overrides = {}) {
  return {
    scripts: new Set(["geo-benchmark-gist.mjs", "check-utf8.sh", "seed.ts"]),
    pkgScripts: new Set(["test:seed-prod-e2e", "lint", "db:seed:prod"]),
    workflows: new Set(["seed-guards.yml", "utf8-check.yml"]),
    workflowCall: new Set(["seed-guards.yml", "utf8-check.yml"]),
    actions: new Set(["setup-bun"]),
    ...overrides,
  }
}

const WORKFLOW_FULL = `name: PR Check
jobs:
  bench:
    steps:
      - name: GiST benchmark
        run: node scripts/geo-benchmark-gist.mjs --providers 500,2000
      - name: Seed prod E2E
        run: bun run test:seed-prod-e2e --skip-docker
      - name: Reusable
        uses: ./.github/workflows/seed-guards.yml
      - name: Bun setup
        uses: ./.github/actions/setup-bun
        with:
          bun-version: \${{ vars.BUN_VERSION }}
`

// ── extractScriptRefs ────────────────────────────────────────────────────

describe("extractScriptRefs", () => {
  it("detecta invocações node/bash/bun com número de linha", () => {
    const content = `run: |
  node scripts/geo-benchmark-gist.mjs
  bash scripts/check-utf8.sh --ci src/
  bun scripts/seed.ts
`
    const refs = extractScriptRefs(content)
    expect(refs).toHaveLength(3)
    expect(refs[0]).toMatchObject({ line: 2, ref: "geo-benchmark-gist.mjs" })
    expect(refs[1]).toMatchObject({ line: 3, ref: "check-utf8.sh" })
    expect(refs[2]).toMatchObject({ line: 4, ref: "seed.ts" })
  })

  it("não casa menções em texto sem invocação (sem prefixo node/bash)", () => {
    const content = `run: |
  # veja scripts/geo-benchmark-gist.mjs para detalhes
  echo "docs em scripts/check-utf8.sh"
  cat README.md
`
    expect(extractScriptRefs(content)).toEqual([])
  })

  it("ignora comentários e linhas vazias; só-${{ }} não gera ref", () => {
    const content = `# node scripts/geo-benchmark-gist.mjs
  run: |
    node scripts/geo-benchmark-gist.mjs
    node scripts/\${{ matrix.script }}
`
    const refs = extractScriptRefs(content)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ line: 3, ref: "geo-benchmark-gist.mjs" })
  })

  it("valida ref estática mesmo com expressão ${{ }} na mesma linha", () => {
    const content = `run: node scripts/geo-benchmark-gist.mjs --providers \${{ matrix.providers }}
`
    const refs = extractScriptRefs(content)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ line: 1, ref: "geo-benchmark-gist.mjs" })
  })

  it("suporta python3 scripts/X", () => {
    const content = `run: python3 scripts/check_utf8.py --ci src/
`
    const refs = extractScriptRefs(content)
    expect(refs[0]).toMatchObject({ ref: "check_utf8.py" })
  })

  it("aceita caminho com ./ antes de scripts/", () => {
    const content = `run: node ./scripts/geo-benchmark-gist.mjs --json\n`
    const refs = extractScriptRefs(content)
    expect(refs[0]).toMatchObject({ ref: "geo-benchmark-gist.mjs" })
  })
})

// ── extractPkgScriptRefs ─────────────────────────────────────────────────

describe("extractPkgScriptRefs", () => {
  it("detecta bun|npm|pnpm|yarn run <entry>", () => {
    const content = `run: |
  bun run test:seed-prod-e2e --skip-docker
  npm run lint
  pnpm run db:seed:prod
  yarn run test:seed-prod-e2e
`
    const refs = extractPkgScriptRefs(content)
    expect(refs).toHaveLength(4)
    expect(refs[0]).toMatchObject({ line: 2, ref: "test:seed-prod-e2e" })
    expect(refs[1]).toMatchObject({ line: 3, ref: "lint" })
    expect(refs[2]).toMatchObject({ line: 4, ref: "db:seed:prod" })
    expect(refs[3]).toMatchObject({ line: 5, ref: "test:seed-prod-e2e" })
  })

  it("não casa bunx/npx (npx-style)", () => {
    const content = `run: |
  bunx prisma generate
  npx playwright install
  node -e "console.log('ok')"
`
    expect(extractPkgScriptRefs(content)).toEqual([])
  })

  it("menção em prosa sem o padrão <pm> run <entry> não casa", () => {
    // Prosa que NÃO contém a sequência literal 'bun run X' não casa. (Se a
    // prosa contiver 'bun run lint' literal, o regex casa por design — é um
    // guard heurístico; a fixture abaixo evita o padrão exato.)
    const content = `run: |
  echo "veja os scripts de lint no package.json"
  cat scripts/foo.sh
`
    expect(extractPkgScriptRefs(content)).toEqual([])
  })

  it("captura a entry antes de flags/argumentos", () => {
    const content = `run: bun run test:seed-prod-e2e --skip-docker --skip-cleanup\n`
    const refs = extractPkgScriptRefs(content)
    expect(refs[0]).toMatchObject({ ref: "test:seed-prod-e2e" })
  })
})

// ── extractPkgScriptTarget ───────────────────────────────────────────────

describe("extractPkgScriptTarget", () => {
  it("extrai o alvo scripts/X de uma entry que invoca script", () => {
    expect(extractPkgScriptTarget("bash scripts/test-seed-prod-e2e.sh --skip-docker")).toBe(
      "test-seed-prod-e2e.sh",
    )
    expect(extractPkgScriptTarget("node scripts/run-benchmark.mjs --type geo")).toBe(
      "run-benchmark.mjs",
    )
    expect(extractPkgScriptTarget("bun scripts/seed.ts")).toBe("seed.ts")
  })

  it("aceita caminho com ./ antes de scripts/", () => {
    expect(extractPkgScriptTarget("bash ./scripts/check-utf8.sh --ci src/")).toBe("check-utf8.sh")
  })

  it("retorna null para entry SEM invocação de scripts/ (não há alvo a validar)", () => {
    expect(extractPkgScriptTarget("eslint .")).toBeNull()
    expect(extractPkgScriptTarget("bunx prisma generate")).toBeNull()
    expect(extractPkgScriptTarget("next build")).toBeNull()
  })

  it("retorna null para valor vazio/undefined", () => {
    expect(extractPkgScriptTarget("")).toBeNull()
    expect(extractPkgScriptTarget(undefined)).toBeNull()
  })
})

// ── checkPkgInternalTargets (consistência INTERNA do package.json) ───────

describe("checkPkgInternalTargets", () => {
  it("entry que invoca scripts/X DELETADO → violação (mesmo sem workflow referenciando)", () => {
    const violations = checkPkgInternalTargets(
      {
        "test:seed-prod-e2e": "bash scripts/test-seed-prod-e2e.sh --skip-docker",
        "check:lint": "eslint .",
      },
      new Set(["geo-benchmark-gist.mjs"]), // test-seed-prod-e2e.sh AUSENTE
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      file: "package.json",
      kind: "package.json",
      ref: "test:seed-prod-e2e",
    })
    expect(violations[0].detail).toContain("test-seed-prod-e2e.sh")
    expect(violations[0].detail).toContain("NÃO existe")
  })

  it("entry que invoca scripts/X EXISTENTE → sem violação", () => {
    const violations = checkPkgInternalTargets(
      { "bench:geo": "node scripts/run-benchmark.mjs --type geo" },
      new Set(["run-benchmark.mjs"]),
    )
    expect(violations).toEqual([])
  })

  it("entry SEM invocação de scripts/ (eslint/bunx/next) → sem alvo a validar", () => {
    const violations = checkPkgInternalTargets(
      { lint: "eslint .", "db:generate": "bunx prisma generate", build: "next build" },
      new Set([]),
    )
    expect(violations).toEqual([])
  })

  it("entries vazias → sem violações", () => {
    expect(checkPkgInternalTargets({}, new Set(["x.mjs"]))).toEqual([])
  })
})

// ── pkgEntryLine ──────────────────────────────────────────────────────────

describe("pkgEntryLine", () => {
  it("encontra a linha (1-based) da entry no texto cru", () => {
    const raw = `{\n  "scripts": {\n    "test:seed-prod-e2e": "bash scripts/test-seed-prod-e2e.sh",\n    "lint": "eslint ."\n  }\n}\n`
    expect(pkgEntryLine(raw, "test:seed-prod-e2e")).toBe(3)
    expect(pkgEntryLine(raw, "lint")).toBe(4)
  })

  it("retorna 0 para entry inexistente (defensivo)", () => {
    expect(pkgEntryLine('{"scripts":{}}', "nope")).toBe(0)
    expect(pkgEntryLine("", "nope")).toBe(0)
  })

  it('NÃO casa valor de string que contenha "<entry>" escapado — só a posição de CHAVE', () => {
    // a entry `lint` real está na linha 4; a linha 2 tem um VALOR que
    // contém \"lint\" escapado (JSON) — o match deve ser SÓ na chave
    const raw = `{\n  "scripts": {\n    "a": "echo \\"lint\\" && x",\n    "lint": "eslint ."\n  }\n}\n`
    expect(pkgEntryLine(raw, "lint")).toBe(4)
  })
})

// ── extractWorkflowUses ──────────────────────────────────────────────────

describe("extractWorkflowUses", () => {
  it("detecta uses: ./.github/workflows/X.yml", () => {
    const content = `jobs:
  guards:
    uses: ./.github/workflows/seed-guards.yml
  utf8:
    uses: ./.github/workflows/utf8-check.yml
`
    const refs = extractWorkflowUses(content)
    expect(refs).toHaveLength(2)
    expect(refs[0]).toMatchObject({ line: 3, ref: "seed-guards.yml" })
    expect(refs[1]).toMatchObject({ line: 5, ref: "utf8-check.yml" })
  })

  it("não casa actions externas nem menções em texto (sem prefixo uses:)", () => {
    const content = `jobs:
  checkout:
    uses: actions/checkout@v4
  comentário:
    # menção em prosa: ./.github/workflows/seed-guards.yml é usado nos E2Es
    run: echo "ver ./.github/workflows/seed-guards.yml"
`
    const refs = extractWorkflowUses(content)
    expect(refs).toHaveLength(0)
  })

  it("detecta ref estática mesmo com expressão ${{ }} na mesma linha", () => {
    const content = `jobs:
  guards:
    uses: ./.github/workflows/seed-guards.yml # \${{ matrix.cond }} descarta
`
    const refs = extractWorkflowUses(content)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ line: 3, ref: "seed-guards.yml" })
  })
})

// ── extractActionUses ────────────────────────────────────────────────────

describe("extractActionUses", () => {
  it("detecta uses: ./.github/actions/<name>", () => {
    const content = `jobs:
  check:
    steps:
      - uses: ./.github/actions/setup-bun
`
    const refs = extractActionUses(content)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ line: 4, ref: "setup-bun" })
  })

  it("não casa actions externas (actions/checkout) nem reusable workflows", () => {
    const content = `jobs:
  c:
    steps:
      - uses: actions/checkout@v4
  g:
    uses: ./.github/workflows/seed-guards.yml
`
    expect(extractActionUses(content)).toEqual([])
  })
})

// ── checkWorkflowFile ────────────────────────────────────────────────────

describe("checkWorkflowFile", () => {
  it("workflow com todas as referências resolvidas → sem violações", () => {
    expect(checkWorkflowFile("pr-check.yml", WORKFLOW_FULL, makeCtx())).toEqual([])
  })

  it("script ausente em scripts/ → violação kind=script", () => {
    const content = `run: node scripts/geo-benchmark-gone.mjs\n`
    const violations = checkWorkflowFile("bench.yml", content, makeCtx())
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      file: "bench.yml",
      line: 1,
      kind: "script",
      ref: "geo-benchmark-gone.mjs",
    })
  })

  it("entry ausente em package.json → violação kind=package.json", () => {
    const content = `run: bun run test:seed-removed-e2e\n`
    const violations = checkWorkflowFile("bench.yml", content, makeCtx())
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      file: "bench.yml",
      kind: "package.json",
      ref: "test:seed-removed-e2e",
    })
  })

  it("TRANSITIVO: entry EXISTE mas o alvo scripts/X não → violação kind=package.json com detail", () => {
    // espelho do mapeamento bun run do check-mutation-jobs: a entry existe,
    // mas o script que ela invoca foi deletado — o run: falharia no runtime
    const content = `run: bun run test:seed-prod-e2e\n`
    const ctx = makeCtx({
      pkgScripts: new Set(["test:seed-prod-e2e", "lint"]),
      // lint ('eslint .') NÃO invoca scripts/ — o readPkgScripts real filtra
      // esse target (extractPkgScriptTarget → null); fora do Map, como na
      // produção. Um 'bun run lint' nunca geraria violação transitiva.
      pkgTargets: new Map([["test:seed-prod-e2e", "test-seed-prod-e2e.sh"]]),
      scripts: new Set(["geo-benchmark-gist.mjs", "check-utf8.sh"]), // alvo AUSENTE
    })
    const violations = checkWorkflowFile("bench.yml", content, ctx)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      file: "bench.yml",
      kind: "package.json",
      ref: "test:seed-prod-e2e",
    })
    expect(violations[0].detail).toContain("test-seed-prod-e2e.sh")
    expect(violations[0].detail).toContain("NÃO existe")
  })

  it("TRANSITIVO: entry existe E o alvo existe → sem violação (par fechado)", () => {
    const content = `run: bun run test:seed-prod-e2e\n`
    const ctx = makeCtx({
      pkgScripts: new Set(["test:seed-prod-e2e"]),
      pkgTargets: new Map([["test:seed-prod-e2e", "test-seed-prod-e2e.sh"]]),
      scripts: new Set(["geo-benchmark-gist.mjs", "test-seed-prod-e2e.sh"]),
    })
    expect(checkWorkflowFile("bench.yml", content, ctx)).toEqual([])
  })

  it("TRANSITIVO: sem pkgTargets no ctx (legacy) → não gera violação transitiva", () => {
    // ctx SEM o campo pkgTargets (compat com fixtures antigas): o optional
    // chaining cai para undefined — só a checagem de entry existir vale
    const content = `run: bun run lint\n`
    expect(checkWorkflowFile("bench.yml", content, makeCtx())).toEqual([])
  })

  it("workflow local ausente → violação kind=workflow", () => {
    const content = `jobs:\n  g:\n    uses: ./.github/workflows/seed-deleted.yml\n`
    const violations = checkWorkflowFile("pr-check.yml", content, makeCtx())
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ kind: "workflow", ref: "seed-deleted.yml" })
  })

  it("workflow existente sem on: workflow_call → violação com detail", () => {
    const content = `jobs:\n  g:\n    uses: ./.github/workflows/utf8-check.yml\n`
    const ctx = makeCtx({ workflowCall: new Set(["seed-guards.yml"]) })
    const violations = checkWorkflowFile("pr-check.yml", content, ctx)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ kind: "workflow", ref: "utf8-check.yml" })
    expect(violations[0].detail).toContain("workflow_call")
  })

  it("action local ausente em .github/actions/ → violação kind=action", () => {
    const content = `steps:\n  - uses: ./.github/actions/setup-bun-gone\n`
    const violations = checkWorkflowFile("pr-check.yml", content, makeCtx())
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ kind: "action", ref: "setup-bun-gone" })
  })

  it("action local resolvido → sem violação", () => {
    const content = `steps:\n  - uses: ./.github/actions/setup-bun\n`
    expect(checkWorkflowFile("pr-check.yml", content, makeCtx())).toEqual([])
  })

  it("múltiplas violações no mesmo arquivo são todas reportadas", () => {
    const content = `run: |
  node scripts/foo-gone.mjs
  bun run test:gone
`
    const violations = checkWorkflowFile("bad.yml", content, makeCtx())
    expect(violations).toHaveLength(2)
    expect(violations.map((v) => v.kind)).toEqual(["script", "package.json"])
  })
})

// ── scanWorkflows ────────────────────────────────────────────────────────

describe("scanWorkflows", () => {
  it("mescla violações de múltiplos arquivos com nome do arquivo", () => {
    const files = [
      { name: "bench.yml", content: "run: node scripts/foo-gone.mjs\n" },
      { name: "ok.yml", content: "run: node scripts/geo-benchmark-gist.mjs\n" },
      { name: "deploy.yml", content: "run: bun run test:gone\n" },
    ]
    const violations = scanWorkflows(files, makeCtx())
    expect(violations).toHaveLength(2)
    expect(violations.map((v) => v.file)).toEqual(["bench.yml", "deploy.yml"])
  })

  it("lista vazia → sem violações", () => {
    expect(scanWorkflows([], makeCtx())).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// `defaults: run:` NÃO é passo — uma ref achada na declaração de shell default
// aponta para um script que a pipeline NUNCA executa
// ─────────────────────────────────────────────────────────────────────────────

describe("a declaração `defaults.run` não produz referência", () => {
  const WF = [
    "name: x",
    "on: [push]",
    "defaults:",
    "  run: node scripts/check-fantasma.mjs",
    "jobs:",
    "  a:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: node scripts/check-de-verdade.mjs",
  ].join("\n")

  it("`extractScriptRefs` só vê a ref do PASSO", () => {
    expect(extractScriptRefs(WF).map((r) => r.ref)).toEqual(["check-de-verdade.mjs"])
  })

  it("`extractPkgScriptRefs` idem (a entry da declaração não conta)", () => {
    const wf = [
      "defaults:",
      "  run: bun run check:fantasma",
      "jobs:",
      "  a:",
      "    steps:",
      "      - run: bun run check:de-verdade",
    ].join("\n")
    expect(extractPkgScriptRefs(wf).map((r) => r.ref)).toEqual(["check:de-verdade"])
  })

  it("a linha do passo segue na lista (o guard não ficou cego)", () => {
    expect(extractScriptRefs(WF)).toHaveLength(1)
  })
})
