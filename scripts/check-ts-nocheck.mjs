#!/usr/bin/env node

// =============================================================================
// check-ts-nocheck.mjs
//
// CI guard that fails if any non-generated source or test file contains
// `@ts-nocheck`.  The directive silently disables type checking for an entire
// file — real type errors then ship undetected (the exact class of bugs this
// repo already paid for with pre-existing test regressions).
//
// Scope:
//   - src/  — app source + tests
//   - e2e/  — Playwright specs
//   - EXCLUDES node_modules/.next/.freebuff (tool caches, never source)
//
// NOTA (09/2026): até então este guard pulava qualquer diretório chamado
// `generated`, porque o repo versionava `src/generated/prisma` (client Prisma
// gerado à mão, 25 arquivos com `@ts-nocheck`). Esse artefato foi removido — o
// client agora vem de node_modules/.prisma via `bun run db:generate` — então a
// exceção virou buraco: bastava um `src/quimquer/generated/x.ts` para escapar
// do guard. Removida: a regra vale para todo o src/ e e2e/.
//
// Usage:
//   node scripts/check-ts-nocheck.mjs
//
// Exit codes:
//   0 — no @ts-nocheck found (pass)
//   1 — at least one @ts-nocheck found (fail)
// =============================================================================

import { execSync } from "node:child_process"

const EXCLUDE_FLAGS = ["node_modules", ".next", ".freebuff"]
  .map((d) => `--exclude-dir=${d}`)
  .join(" ")

try {
  const out = execSync(
    `grep -rn "@ts-nocheck" src/ e2e/ ${EXCLUDE_FLAGS} --include='*.ts' --include='*.tsx'`,
    { stdio: "pipe", shell: true, encoding: "utf-8" },
  )
  const lines = out.trim().split("\n").filter(Boolean)
  const files = [...new Set(lines.map((l) => l.split(":")[0]))]
  console.error(
    `❌ @ts-nocheck found in ${files.length} file(s):\n` +
      lines.map((l) => `   - ${l}`).join("\n") +
      `\n\n   @ts-nocheck disables type checking for the whole file — ` +
      `remove the directive and fix the underlying type errors instead.`,
  )
  process.exit(1)
} catch {
  // grep exited non-zero → no matches found → pass
  process.exit(0)
}
