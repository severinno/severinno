/**
 * check-hooks-symmetry.test.ts
 *
 * Testes unitários das funções PURAS de scripts/check-hooks-symmetry.mjs:
 * extração de guards dos hooks reais, do runner compartilhado e da tabela
 * "## Git Hooks" do README, e a validação de simetria (checkSymmetry).
 *
 * Cobre:
 *   - extractHookGuards: `node scripts/X --staged` (chave com sufixo),
 *     `bash scripts/X.sh`, comandos diretos (bun run typecheck / test:unit /
 *     lint-staged), ignorar linhas de comentário/strings (ex.: SKIP_PATTERN
 *     com 'scripts/' no pre-push não gera guard fantasma)
 *   - extractRunnerGuards: lista os scripts do runner sem duplicatas
 *   - extractReadmeRows: header/separator ignorados, chaves canônicas
 *     (inclusive variante --staged), colunas ✅/—
 *   - rowKeyFromDesc: mapeamentos por descrição (test:unit, typecheck,
 *     lint-staged, imports) e por script na descrição
 *   - checkSymmetry: pass quando sync; falha com guard novo sem linha;
 *     falha com linha sem o ✅ na coluna do hook; falha com chave desconhecida
 *   - checkReverseSymmetry: pass quando toda linha corresponde a um guard
 *     real; falha com linha STALE (chave sem guard em nenhum hook); falha
 *     com linha descritiva sem exceção documentada; falha com exceção cuja
 *     âncora de hook sumiu; aceita exceções custom via parâmetro
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-hooks-symmetry.test.ts
 */

import { describe, it, expect } from "vitest"
import {
  extractHookGuards,
  extractRunnerGuards,
  extractReadmeRows,
  rowKeyFromDesc,
  checkSymmetry,
  checkReverseSymmetry,
  DESCRIPTIVE_ROW_EXCEPTIONS,
} from "../../../scripts/check-hooks-symmetry.mjs"

// ── Fixtures (parciais e suficientes para as funções puras) ──────────────

const PRE_COMMIT = `set -euo pipefail

# Bun guard STAGED — detecta cache keys/literais velhos no que está STAGED
node scripts/check-bun-mirror.mjs --staged

bash scripts/run-encoding-guards.sh
bun x lint-staged

# Direct RTL import check
bun run check:direct-rtl-import

bun run barrel-lint
bun run typecheck

STAGED_SNAP=$(git diff --cached --name-only | grep -E '\\.snap$' || true)
if [ -n "$STAGED_SNAP" ]; then
  bun test:snapshots
fi
`

const PRE_PUSH = `set -euo pipefail

bash scripts/run-encoding-guards.sh

# ── Smart skip ──
SKIP_PATTERN='\\.(md|json|yaml)$|^docs/|scripts/foo.sh'

if [ "$SHOULD_RUN_TESTS" = true ]; then
  bun run test:unit
  bun run fuzz:ci
  bun run fuzz
fi
`

const RUNNER = `#!/usr/bin/env bash
# 1. check-utf8.sh            — UTF-8 válido
# 2. check-crlf.sh            — working tree sem CRLF
bash scripts/check-utf8.sh --dry-run --ci src/
bash scripts/check-crlf.sh --ci
node scripts/check-bun-mirror.mjs
node scripts/scan-lucide-icons.mjs --check
`

const README_TABLE = `## Git Hooks — Pre-commit vs Pre-push (simetria)

| Validação                                                 | Pre-commit |   Pre-push    |
| :-------------------------------------------------------- | :--------: | :-----------: |
| UTF-8 (\`check-utf8.sh --dry-run --ci src/\`)               |     ✅     |      ✅       |
| CRLF working tree (\`check-crlf.sh --ci\`)                  |     ✅     |      ✅       |
| Fonte única Bun (\`check-bun-mirror.mjs\`)                  |     ✅     |      ✅       |
| Bun staged diff (\`check-bun-mirror.mjs --staged\`)         |     ✅     |       —       |
| Ícones lucide (\`scan-lucide-icons.mjs --check\`)           |     ✅     |      ✅       |
| Format + lint (lint-staged: prettier + eslint --fix)      |     ✅     |       —       |
| Imports diretos (check:direct-rtl-import + barrel-lint)   |     ✅     |       —       |
| Barrel lint (\`barrel-lint\`)                               |     ✅     |       —       |
| Typecheck (\`tsc --noEmit\`)                                |     ✅     |       —       |
| Snapshots (quando .snap/snapshot tests alterados)         |  ✅ cond.  |       —       |
| Testes unitários + fuzz (\`test:unit\`/\`fuzz:ci\`/\`fuzz\`)    |     —      | ✅ smart-skip |

## Regression Guards
`

// ── extractHookGuards ────────────────────────────────────────────────────

describe("extractHookGuards", () => {
  it("extrai scripts com sufixo de flag (chave distinta) e scripts simples", () => {
    const guards = extractHookGuards(PRE_COMMIT)
    expect(guards.has("check-bun-mirror.mjs --staged")).toBe(true)
    expect(guards.has("check-bun-mirror.mjs")).toBe(false) // global só no runner
    // o runner NÃO é guard — a linha bash scripts/run-encoding-guards.sh é ignorada
    expect(guards.has("run-encoding-guards.sh")).toBe(false)
  })

  it("mapeia comandos diretos (bun run/bun x) para chaves canônicas", () => {
    const guards = extractHookGuards(PRE_COMMIT)
    expect(guards.has("typecheck")).toBe(true)
    expect(guards.has("check-direct-rtl-import")).toBe(true)
    expect(guards.has("barrel-lint")).toBe(true)
    expect(guards.has("lint-staged")).toBe(true)
  })

  it("NÃO gera guard fantasma a partir de strings/comentários (SKIP_PATTERN)", () => {
    const guards = extractHookGuards(PRE_PUSH)
    // 'scripts/foo.sh' aparece DENTRO de uma string do SKIP_PATTERN — não é comando
    expect(guards.has("foo.sh")).toBe(false)
    expect(guards.has("run-encoding-guards.sh")).toBe(false)
    expect(guards.has("test:unit")).toBe(true)
  })
})

// ── extractRunnerGuards ──────────────────────────────────────────────────

describe("extractRunnerGuards", () => {
  it("lista os scripts do runner compartilhado sem duplicatas", () => {
    const guards = extractRunnerGuards(RUNNER)
    expect(guards).toContain("check-utf8.sh")
    expect(guards).toContain("check-crlf.sh")
    expect(guards).toContain("check-bun-mirror.mjs")
    expect(guards).toContain("scan-lucide-icons.mjs")
    // 'run-encoding-guards.sh' NÃO deve aparecer (só executa scripts internos)
    expect(guards).not.toContain("run-encoding-guards.sh")
  })
})

// ── rowKeyFromDesc / extractReadmeRows ───────────────────────────────────

describe("rowKeyFromDesc", () => {
  it("deriva chave do script na descrição (com/sem sufixo de flag)", () => {
    expect(rowKeyFromDesc("UTF-8 (`check-utf8.sh --dry-run --ci src/`)")).toBe("check-utf8.sh")
    expect(rowKeyFromDesc("Bun staged diff (`check-bun-mirror.mjs --staged`)")).toBe(
      "check-bun-mirror.mjs --staged",
    )
  })

  it("mapeia descrições sem script via lookup", () => {
    expect(rowKeyFromDesc("Testes unitários + fuzz (`test:unit`/`fuzz:ci`/`fuzz`)")).toBe(
      "test:unit",
    )
    expect(rowKeyFromDesc("Typecheck (`tsc --noEmit`)")).toBe("typecheck")
    expect(rowKeyFromDesc("Format + lint (lint-staged: prettier + eslint --fix)")).toBe(
      "lint-staged",
    )
  })
})

describe("extractReadmeRows", () => {
  it("ignora header/separator e lê colunas ✅/—", () => {
    const rows = extractReadmeRows(README_TABLE)
    expect(rows.get("check-utf8.sh")).toEqual({
      desc: "UTF-8 (`check-utf8.sh --dry-run --ci src/`)",
      preCommit: true,
      prePush: true,
    })
    expect(rows.get("check-bun-mirror.mjs --staged")).toMatchObject({
      preCommit: true,
      prePush: false,
    })
    expect(rows.get("test:unit")).toMatchObject({ preCommit: false, prePush: true })
    expect(rows.get("barrel-lint")).toMatchObject({ preCommit: true, prePush: false })
    // para na seção seguinte — '## Regression Guards' não vira linha
    expect(rows.size).toBe(11) // 10 guard + 1 descritiva (Snapshots)
  })

  it("inclui linha descritiva (Snapshots) com chave sintética @desc:", () => {
    const rows = extractReadmeRows(README_TABLE)
    const descKey = [...rows.keys()].find((k) => k.startsWith("@desc:"))
    expect(descKey).toBeTruthy()
    expect(descKey).toContain("Snapshots")
    expect(rows.get(descKey!)).toMatchObject({
      preCommit: true, // ✅ cond.
      prePush: false,
    })
  })

  it("robusto a conversão parágrafo→heading ANTES da tabela: linhas não mudam", () => {
    // um parágrafo de introdução vira `### ...` (heading) entre a seção e a
    // tabela — o extractor só conta linhas `|`, então o Map permanece com 11
    // entradas (10 guards + 1 descritiva)
    const content = README_TABLE.replace(
      "## Git Hooks — Pre-commit vs Pre-push (simetria)",
      "## Git Hooks — Pre-commit vs Pre-push (simetria)\n\n### Introdução (convertido de parágrafo)",
    )
    const rows = extractReadmeRows(content)
    expect(rows.size).toBe(11)
    expect(rows.get("check-utf8.sh")).toMatchObject({ preCommit: true, prePush: true })
  })

  it("robusto a conversão parágrafo→heading DEPOIS da tabela: linhas não mudam", () => {
    const content = README_TABLE.replace(
      "## Regression Guards",
      "### Nota pós-tabela (convertida de parágrafo)\n\n## Regression Guards",
    )
    expect(extractReadmeRows(content).size).toBe(11)
  })

  it("robusto a heading com a MESMA aparência de linha de tabela fora dela", () => {
    // heading convertido que CONTÉM um pipe — começa com `#`, não com `|`,
    // então não entra na contagem de linhas da tabela
    const content = README_TABLE.replace(
      "## Git Hooks — Pre-commit vs Pre-push (simetria)",
      "## Git Hooks — Pre-commit vs Pre-push (simetria)\n\n### Pipe | no texto",
    )
    expect(extractReadmeRows(content).size).toBe(11)
  })
})

// ── checkSymmetry ────────────────────────────────────────────────────────

describe("checkSymmetry", () => {
  const rows = extractReadmeRows(README_TABLE)

  it("passa quando todos os guards dos hooks estão na tabela com o ✅ certo", () => {
    const violations = checkSymmetry(
      {
        shared: ["check-utf8.sh", "check-crlf.sh", "check-bun-mirror.mjs", "scan-lucide-icons.mjs"],
        preCommit: ["check-bun-mirror.mjs --staged", "lint-staged", "typecheck", "barrel-lint"],
        prePush: ["test:unit"],
      },
      rows,
    )
    expect(violations).toEqual([])
  })

  it("falha com guard novo no hook SEM linha na tabela (o caso de drift)", () => {
    const violations = checkSymmetry(
      { shared: [], preCommit: ["check-novo-guard.mjs"], prePush: [] },
      rows,
    )
    expect(violations.length).toBe(1)
    expect(violations[0]).toContain("check-novo-guard.mjs")
    expect(violations[0]).toContain("pre-commit")
    expect(violations[0]).toContain("tabela '## Git Hooks'")
  })

  it("falha quando a linha existe mas marca '—' na coluna do hook", () => {
    // test:unit roda no pre-push mas a coluna Pre-commit é '—' → só falha se
    // alguém declará-lo como pre-commit; aqui validamos o pre-push ok + falha
    // de guard declarado em hook errado (typecheck no pre-push)
    const violations = checkSymmetry({ shared: [], preCommit: [], prePush: ["typecheck"] }, rows)
    expect(violations.length).toBe(1)
    expect(violations[0]).toContain("typecheck")
    expect(violations[0]).toContain("Pre-push")
  })

  it("shared guard sem a linha na tabela falha nas duas colunas", () => {
    const violations = checkSymmetry(
      { shared: ["check-ghost.mjs"], preCommit: [], prePush: [] },
      rows,
    )
    expect(violations.length).toBe(2) // pre-commit + pre-push
    expect(violations[0]).toContain("check-ghost.mjs")
  })
})

// ── checkReverseSymmetry ─────────────────────────────────────────────────

/**
 * `actual` completo do fixture: todos os guards reais invocados pelos hooks
 * (runner compartilhado + pre-commit + pre-push) — espelha o que o main()
 * monta a partir de extractHookGuards/extractRunnerGuards.
 */
const ACTUAL = {
  shared: ["check-utf8.sh", "check-crlf.sh", "check-bun-mirror.mjs", "scan-lucide-icons.mjs"],
  preCommit: [
    "check-bun-mirror.mjs --staged",
    "lint-staged",
    "check-direct-rtl-import",
    "barrel-lint",
    "typecheck",
  ],
  prePush: ["test:unit"],
}

/** Content do pre-commit com o bloco condicional de snapshots (âncora). */
const PRE_COMMIT_WITH_SNAPSHOTS = `set -euo pipefail
node scripts/check-bun-mirror.mjs --staged
bun x lint-staged
bun run typecheck

STAGED_SNAP=$(git diff --cached --name-only | grep -E '\\.snap$' || true)
if [ -n "$STAGED_SNAP" ]; then
  bun test:snapshots
fi
`

const PRE_PUSH_EMPTY = `set -euo pipefail
bash scripts/run-encoding-guards.sh
`

describe("checkReverseSymmetry", () => {
  it("passa quando toda linha (guard + descritiva) corresponde a um guard real", () => {
    const rows = extractReadmeRows(README_TABLE)
    const violations = checkReverseSymmetry(ACTUAL, rows, PRE_COMMIT_WITH_SNAPSHOTS, PRE_PUSH_EMPTY)
    expect(violations).toEqual([])
  })

  it("falha com linha STALE: chave de guard sem guard real em NENHUM hook", () => {
    // linha com chave de script que não existe em nenhum hook (runner,
    // pre-commit, pre-push) → stale
    const fakeRows = new Map([
      [
        "check-ghost.mjs",
        {
          desc: "Ghost guard (`check-ghost.mjs`)",
          preCommit: true,
          prePush: false,
        },
      ],
    ])
    const violations = checkReverseSymmetry(ACTUAL, fakeRows, "", "")
    expect(violations.length).toBe(1)
    expect(violations[0]).toContain("check-ghost.mjs")
    expect(violations[0]).toContain("stale")
  })

  it("falha com linha descritiva SEM exceção documentada", () => {
    const fakeRows = new Map([
      [
        "@desc:Minificação (`minify:check`)",
        { desc: "Minificação (`minify:check`)", preCommit: true, prePush: false },
      ],
    ])
    const violations = checkReverseSymmetry(ACTUAL, fakeRows, "", "")
    expect(violations.length).toBe(1)
    expect(violations[0]).toContain("DESCRIPTIVE_ROW_EXCEPTIONS")
    expect(violations[0]).toContain("Minificação")
  })

  it("falha quando a âncora do bloco documentado SUMIR dos hooks (stale)", () => {
    const fakeRows = new Map([
      [
        "@desc:Snapshots (quando .snap/snapshot tests alterados)",
        {
          desc: "Snapshots (quando .snap/snapshot tests alterados)",
          preCommit: true,
          prePush: false,
        },
      ],
    ])
    // pre-commit SEM o bloco bun test:snapshots — a âncora sumiu
    const preCommitWithoutSnap = PRE_COMMIT_WITH_SNAPSHOTS.replace(
      "bun test:snapshots",
      "bun test:other",
    )
    const violations = checkReverseSymmetry(ACTUAL, fakeRows, preCommitWithoutSnap, PRE_PUSH_EMPTY)
    expect(violations.length).toBe(1)
    expect(violations[0]).toContain("bun test:snapshots")
    expect(violations[0]).toContain("stale")
  })

  it("passa com exceção descritiva cuja âncora existe no hook", () => {
    const fakeRows = new Map([
      [
        "@desc:Snapshots (quando .snap/snapshot tests alterados)",
        {
          desc: "Snapshots (quando .snap/snapshot tests alterados)",
          preCommit: true,
          prePush: false,
        },
      ],
    ])
    const violations = checkReverseSymmetry(
      ACTUAL,
      fakeRows,
      PRE_COMMIT_WITH_SNAPSHOTS,
      PRE_PUSH_EMPTY,
    )
    expect(violations).toEqual([])
  })

  it("aceita exceções custom via parâmetro (ex.: nova linha descritiva)", () => {
    const fakeRows = new Map([
      [
        "@desc:Fuzz de cache (`cache:fuzz`)",
        { desc: "Fuzz de cache (`cache:fuzz`)", preCommit: false, prePush: true },
      ],
    ])
    const customExceptions = [
      ...DESCRIPTIVE_ROW_EXCEPTIONS,
      { descNeedle: "fuzz de cache", hookAnchor: "bun run fuzz" },
    ]
    const violations = checkReverseSymmetry(
      ACTUAL,
      fakeRows,
      PRE_COMMIT_WITH_SNAPSHOTS,
      `bun run fuzz`,
      customExceptions,
    )
    expect(violations).toEqual([])
    // sem a exceção custom, a mesma linha falharia
    const violationsNoCustom = checkReverseSymmetry(
      ACTUAL,
      fakeRows,
      PRE_COMMIT_WITH_SNAPSHOTS,
      `bun run fuzz`,
    )
    expect(violationsNoCustom.length).toBe(1)
    expect(violationsNoCustom[0]).toContain("DESCRIPTIVE_ROW_EXCEPTIONS")
  })
})
