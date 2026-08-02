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
    expect(rows.size).toBe(10)
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
