#!/usr/bin/env node
/**
 * scan-prepush-batch.mjs - guard do veredito da 11.17 (2026-08-10): o
 * pre-push NAO e batchado - o batch so passa a valer se o pre-push ganhar
 * um SEGUNDO node guard (<0.2s cada).
 *
 * WHY: a 11.17 mediu os gates do pre-push (integrity 0.19s, verify-encoding
 * 2.94s bash multi-camada, run-mapped-fuzz 0.41s+ invocacao vitest) e
 * manteve a assimetria deliberada: o batch economiza o BOOT node (~0.14s)
 * consolidando N spawns em 1 - o pre-push tem EXATAMENTE UM node guard
 * (check-node-modules-integrity), entao batchar economizaria ~0.14s num
 * hook de dezenas de segundos (ruido). A condicao documentada na 11.17:
 * "se um dia o pre-push ganhar um segundo node guard (<0.2s cada), ai o
 * batch passa a valer - ate la, spawn individual e o certo". O veredito
 * vivia SO na doc; este guard TRAVA a condicao estruturalmente.
 *
 * CONTRATO BIDIRECIONAL (mesmo padrao do scan-fuzz-precommit da 11.11):
 * - NEGATIVO: um node guard NOVO spawnado no .husky/pre-push - qualquer
 *   `node scripts/X.mjs` FORA do conjunto pinado abaixo - falha com o
 *   caminho exato, A MENOS que o gates-proofs.md tenha uma secao numerada
 *   11.x declarando o pre-push batchado ADOTADO (a re-mediacao datada que
 *   reverteria o veredito - o padrao de reversao das outras secoes). O
 *   conjunto pinado (a taxonomia da 11.17, nao uma allowlist generica):
 *     - check-node-modules-integrity.mjs = o UNICO node guard legitimo
 *       (a checagem da 8.5 antes do fuzz, ~0.19s);
 *     - check-push-deletion.mjs = o atalho de housekeeping de DELECAO PURA
 *       (nao e um gate - so decide se a cadeia pode ser pulada);
 *     - run-mapped-fuzz.mjs = a invocacao VITEST pesada (a rede estocastica
 *       do push, categoria diferente do agregador sincrono de exit codes - a
 *       11.17 documentou que ele NAO cabe no batch).
 *   Linhas de comentario sao ignoradas (o header do hook explica o POR QUE
 *   em prosa - mesmo padrao dos irmaos). NOTA do trade-off (mesmo do 11.7):
 *   o REVERSAL_RE casa QUALQUER header 11.x com pre-push+ADOTADO na mesma
 *   linha - uma secao futura de adocao nao-relacionada que use ADOTADO
 *   suprimiria o negativo sem reverter o veredito; a re-mediacao legitima
 *   DEVE dizer explicitamente o pre-push batchado.
 * - POSITIVO: o unico node guard legitimo (check-node-modules-integrity)
 *   DEVE existir como spawn INDIVIDUAL no .husky/pre-push (remover ou
 *   mover para um batch sem a nota = o pre-push perde a checagem da 8.5
 *   antes do fuzz gastar ~6-14s - falha 'INTEGRITY GUARD MISSING'). Sob a
 *   nota ADOTADO, o positivo e relaxado (a integracao legitima move o
 *   integrity para dentro do batch - a re-mediacao decidiu).
 *
 * DERIVATION PIN (o padrao do deriveBatchGuards do pre-commit aplicado ao
 * outro hook): a lista de node guards do .husky/pre-push e DERIVADA dos
 * spawns reais do hook (derivePrepushSpawns - todo `node scripts/X.mjs` em
 * linha NAO-comentario, na ordem), nunca hardcoded no guard nem no teste.
 * O scan consome a derivacao (2 usos) e o teste pina a lista viva: a
 * 11.17 diz 'exatamente UM node guard' - se um dev adicionar um 2o guard
 * no pre-push, a lista derivada muda e o DERIVATION PIN quebra ANTES de o
 * scan precisar (o mesmo spread contract dos TARGET_DIRS).
 *
 * Env override PREPUSH_BATCH_SCAN_ROOT (repo sintetico p/ o vitest -
 * espelha o FUZZ_PRECOMMIT_SCAN_ROOT do scan-fuzz-precommit). Saida ASCII
 * pura (gate file). Puro node, sem deps, <10ms.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(process.env.PREPUSH_BATCH_SCAN_ROOT || process.cwd())
// Forward-slash literals (same convention as scan-push-full-suite and
// scan-batch-coverage): Node accepts them on Windows for fs reads, and the
// output path in failure messages stays stable across OSes (path.join
// would emit `\` on Windows and break the exact-path asserts in the vitest
// suite).
const PRE_PUSH = ".husky/pre-push"
const DOC = "docs/gates-proofs.md"

/**
 * The pinned node spawns of the pre-push (the 11.17 taxonomy - NOT a
 * generic allowlist): a 4th entry (a new cheap guard) requires editing this
 * list WITH the re-measured section 11.x, never a silent addition.
 */
export const ALLOWED_NODE_GUARDS = [
  "check-node-modules-integrity.mjs", // o UNICO node guard legitimo (~0.19s, sec 11.17)
  "check-push-deletion.mjs", // atalho de housekeeping (delecao pura) - nao e um gate
  "run-mapped-fuzz.mjs", // invocacao vitest pesada, nao cabe no batch (sec 11.17)
]

/** A `node scripts/X.mjs` spawn in a hook line (the guard-shaped spawn). */
const NODE_GUARD_RE = /node\s+scripts\/([A-Za-z0-9._-]+\.mjs)/

/**
 * Derive the live node-guard spawn list of the pre-push hook: every
 * `node scripts/X.mjs` invocation on a NON-COMMENT line, in order (the
 * pre-commit analog of deriveBatchGuards in scan-batch-coverage.mjs - the
 * hook's own spawns are the single source of truth, never a hardcoded
 * list). Returns [{ module, line, text }]. Exported for the unit tests
 * (the DERIVATION PIN pins the exact live list - a 2nd cheap guard changes
 * it and the pin breaks before the scan even needs to run).
 */
export function derivePrepushSpawns(source) {
  const out = []
  source.split(/\r?\n/).forEach((line, i) => {
    if (isComment(line)) return
    const m = line.match(NODE_GUARD_RE)
    if (m) out.push({ module: m[1], line: i + 1, text: line.trim() })
  })
  return out
}

/**
 * The 11.x reversal note: a dated SECTION HEADER declaring the pre-push
 * batch ADOTADO (e.g. "## 11.18 pre-push batchado - ADOTADO (medicao ...)").
 * Anchored on a header line: prose in the doc explaining the rule does NOT
 * satisfy the contract (a re-mediation must exist as a dated section). The
 * 11.17 header itself ("Pre-push NAO e batchado...") never carries ADOTADO
 * on the same line, so it never satisfies the note - case-insensitive
 * because the repo headers capitalize "Pre-push".
 */
const REVERSAL_RE = /^##\s+11\.\d+.*\bpre-push\b.*\b(?:ADOTADO|ALLOWED)\b/im

/** True when the line is a full-line comment (first non-space char is #). */
function isComment(line) {
  return /^\s*#/.test(line)
}

/**
 * Scan the pre-push node-guard placement. Returns { secondGuard,
 * integrityMissing } where secondGuard is [{ line, text, module }] of NEW
 * node guards in the pre-push (outside the pinned set, without the
 * reversal note) and integrityMissing is [{ text }] when the single
 * legitimate node guard (check-node-modules-integrity) is absent as an
 * individual spawn (and no reversal note re-mediates the layout). All
 * empty = clean. Exported for unit tests.
 */
export function scanPrepushBatch(root = ROOT) {
  const prePushPath = path.join(root, PRE_PUSH)
  // Not scannable without the hook (minimal synthetic root) - clean, same
  // posture as scan-push-full-suite skipping missing files.
  if (!fs.existsSync(prePushPath)) {
    return { secondGuard: [], integrityMissing: [] }
  }

  const reversalNote = (() => {
    const doc = path.join(root, DOC)
    if (!fs.existsSync(doc)) return false
    return REVERSAL_RE.test(fs.readFileSync(doc, "utf8"))
  })()

  // O scan consome a MESMA derivacao que o teste pina (2 usos - a lista
  // viva dos spawns e a fonte unica, nunca uma lista hardcoded).
  const secondGuard = []
  let integrityPresent = false
  for (const s of derivePrepushSpawns(fs.readFileSync(prePushPath, "utf8"))) {
    if (s.module === "check-node-modules-integrity.mjs") integrityPresent = true
    if (ALLOWED_NODE_GUARDS.includes(s.module)) continue
    if (!reversalNote) {
      secondGuard.push({ line: s.line, text: s.text, module: s.module })
    }
  }

  // Sob a nota ADOTADO, o integrity pode ter ido para DENTRO do batch (a
  // integracao legitima da re-mediacao) - o positivo e relaxado.
  const integrityMissing = integrityPresent || reversalNote ? [] : [{ text: PRE_PUSH }]

  return { secondGuard, integrityMissing }
}

export function main() {
  const { secondGuard, integrityMissing } = scanPrepushBatch()
  if (secondGuard.length === 0 && integrityMissing.length === 0) {
    console.log(
      "prepush-batch: clean (single node guard in the pre-push - the 11.17 asymmetry locked)",
    )
    return 0
  }
  for (const o of secondGuard) {
    console.log(
      `prepush-batch: SECOND NODE GUARD at ${PRE_PUSH}:${o.line}: ${o.text} (a 2nd cheap node guard makes the batch worth it - sec 11.17; add a dated section 11.x with ADOTADO to adopt it)`,
    )
  }
  for (const m of integrityMissing) {
    console.log(
      `prepush-batch: INTEGRITY GUARD MISSING in ${m.text} (check-node-modules-integrity individual spawn required - the single pre-push node guard, sec 11.17)`,
    )
  }
  console.log(
    "prepush-batch: sec 11.17 manteve o pre-push NAO batchado (1 node guard ~0.19s vs dezenas de segundos do hook); um 2o node guard so entra com uma secao numerada 11.x ADOTADO + re-mediacao datada no gates-proofs.md",
  )
  return 1
}

// Entry-point guard: only run the CLI when executed directly (vitest imports
// the file for unit tests of scanPrepushBatch without side effects).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
