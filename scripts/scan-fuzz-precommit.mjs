#!/usr/bin/env node
/**
 * scan-fuzz-precommit.mjs - guard do veredito ADOTADO da 11.11 (2026-08-10):
 * o fuzz mapeado e PRE-PUSH-ONLY - o run-mapped-fuzz.mjs NAO roda no commit.
 *
 * WHY: a 11.11 mediu o fuzz:ci (6 spawns ~40.4s, 71% do push) e adotou o
 * runner mapeado no pre-push (rede ESTOCASTICA do push); o commit roda o
 * teste unitario DETERMINISTICO (pre-commit:test --scope cached/staged,
 * o contrato #6 do scan-push-full-suite). O veredito pode regredir
 * silenciosamente: alguem adiciona um modo `--scope cached` ao runner
 * (que hoje SO aceita --since - parseSince ignora --scope, pinado pelo
 * fuzz-mapped.test.ts) e o wired no .husky/pre-commit - o commit passaria
 * a rodar a rede estocastica do fuzz.
 *
 * CONTRATO BIDIRECIONAL (mesmo padrao do scan-lint-staged-loader da 11.7):
 * - NEGATIVO: `run-mapped-fuzz.mjs --scope cached` em QUALQUER linha
 *   NAO-comentario do .husky/pre-commit - a menos que o gates-proofs.md
 *   tenha uma secao numerada 11.x declarando o fuzz no commit ADOTADO (a
 *   re-mediacao datada que reverteria o veredito - o padrao de reversao
 *   das outras secoes). Linhas de comentario sao ignoradas (o header do
 *   hook explica o POR QUE em prosa). NOTA do trade-off (mesmo do 11.7):
 *   o REVERSAL_RE casa QUALQUER header 11.x com fuzz+ADOTADO na mesma
 *   linha - um header futuro de ADOCAO nao-relacionada (ex.: cobertura de
 *   fuzz) que use ADOTADO suprimiria o negativo sem reverter o veredito;
 *   a re-mediacao legitima DEVE dizer explicitamente o fuzz no commit.
 * - POSITIVO: o gate de fuzz mapeado DEVE existir no .husky/pre-push
 *   (`run-mapped-fuzz.mjs --since` - o escopo do push) - deletar o gate =
 *   push sem fuzz que o CI rodaria = falha 'FUZZ GATE MISSING'.
 *
 * NOTA hard-lock (interacao com o scan-push-full-suite, contrato #2): a
 * secao ADOTADO que este guard aceita e a trilha DOC-ONLY - o contrato #2
 * do scan-push-full-suite bane QUALQUER fuzz no pre-commit de forma
 * INCONDICIONAL (sem ler o doc). Reverter a 11.11 de verdade exige EDItAR
 * o contrato #2 (a rede estrutural), nao so adicionar a secao; este guard
 * e a camada que diagnostica a classe --scope cached e documenta a trilha,
 * o #2 e o lock duro.
 *
 * Env override FUZZ_PRECOMMIT_SCAN_ROOT (repo sintetico p/ o vitest -
 * espelha o LINT_LOADER_SCAN_ROOT do scan-lint-staged-loader). Saida ASCII
 * pura (gate file). Puro node, sem deps, <10ms.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(process.env.FUZZ_PRECOMMIT_SCAN_ROOT || process.cwd())
const DOC = path.join("docs", "gates-proofs.md")
const PRE_COMMIT = path.join(".husky", "pre-commit")
const PRE_PUSH = path.join(".husky", "pre-push")

/**
 * The 11.11 regression class: run-mapped-fuzz invoked with a CACHED scope in
 * the pre-commit (a mode the runner does not have today - the commit would
 * run the stochastic fuzz net instead of the deterministic unit test).
 * Matches `--scope cached` and `--scope=cached` forms.
 */
const CACHED_SCOPE_RE = /run-mapped-fuzz\.mjs\s+--scope(?:\s+|=)cached\b/

/** The mapped fuzz gate must exist in the pre-push (--since, the push scope). */
const FUZZ_GATE_RE = /run-mapped-fuzz\.mjs\s+--since/

/**
 * The 11.x reversal note: a dated SECTION HEADER declaring the fuzz in the
 * commit ADOTADO (e.g. "## 11.16 fuzz no commit - ADOTADO (medicao ...)").
 * Anchored on a header line: prose in the doc explaining the rule does NOT
 * satisfy the contract (a re-mediation must exist as a dated section). The
 * legit adoption headers (11.11/11.12) carry "Fuzz" but never ADOTADO on
 * the same line, so they never satisfy the note.
 */
const REVERSAL_RE = /^##\s+11\.\d+.*\bfuzz\b.*\b(?:ADOTADO|ALLOWED)\b/im

/** True when the line is a full-line comment (first non-space char is #). */
function isComment(line) {
  return /^\s*#/.test(line)
}

/**
 * Scan the fuzz gate placement. Returns { cachedScope, missingGate } where
 * cachedScope is [{ line, text }] of fuzz-in-pre-commit invocations with a
 * cached scope (without the reversal note) and missingGate is [{ text }]
 * when no mapped fuzz gate exists in the pre-push. All empty = clean.
 * Exported for unit tests.
 */
export function scanFuzzPrecommit(root = ROOT) {
  const preCommitPath = path.join(root, PRE_COMMIT)
  const prePushPath = path.join(root, PRE_PUSH)
  // Not scannable without the hooks (minimal synthetic root) - clean, same
  // posture as scan-push-full-suite skipping missing files.
  if (!fs.existsSync(preCommitPath) && !fs.existsSync(prePushPath)) {
    return { cachedScope: [], missingGate: [] }
  }

  const reversalNote = (() => {
    const doc = path.join(root, DOC)
    if (!fs.existsSync(doc)) return false
    return REVERSAL_RE.test(fs.readFileSync(doc, "utf8"))
  })()

  const cachedScope = []
  if (fs.existsSync(preCommitPath)) {
    const lines = fs.readFileSync(preCommitPath, "utf8").split(/\r?\n/)
    lines.forEach((line, i) => {
      if (isComment(line)) return
      if (!reversalNote && CACHED_SCOPE_RE.test(line)) {
        cachedScope.push({ line: i + 1, text: line.trim() })
      }
    })
  }

  const missingGate = []
  if (fs.existsSync(prePushPath) && !FUZZ_GATE_RE.test(fs.readFileSync(prePushPath, "utf8"))) {
    missingGate.push({ text: ".husky/pre-push" })
  }

  return { cachedScope, missingGate }
}

export function main() {
  const { cachedScope, missingGate } = scanFuzzPrecommit()
  if (cachedScope.length === 0 && missingGate.length === 0) {
    console.log(
      "fuzz-precommit: clean (no --scope cached in pre-commit, mapped fuzz gate present in pre-push - sec 11.11 ADOTADO locked)",
    )
    return 0
  }
  for (const o of cachedScope) {
    console.log(
      `fuzz-precommit: FUZZ IN PRE-COMMIT (--scope cached) at .husky/pre-commit:${o.line}: ${o.text}`,
    )
  }
  for (const m of missingGate) {
    console.log(
      `fuzz-precommit: FUZZ GATE MISSING in ${m.text} (run-mapped-fuzz.mjs --since required, sec 11.11)`,
    )
  }
  console.log(
    "fuzz-precommit: sec 11.11 manteve o fuzz PRE-PUSH-ONLY (rede estocastica no push, teste deterministico no commit); para re-adotar o fuzz no commit, adicione uma secao numerada 11.x com ADOTADO e a re-mediacao datada no gates-proofs.md",
  )
  return 1
}

// Entry-point guard: only run the CLI when executed directly (vitest imports
// the file for unit tests of scanFuzzPrecommit without side effects).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
