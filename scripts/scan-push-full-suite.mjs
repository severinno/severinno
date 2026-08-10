#!/usr/bin/env node
/**
 * scan-push-full-suite.mjs - guard de CONTRATOS dos gates de custo nos hooks
 * (2026-08): Gate 3 mapeado + fuzz:ci pre-push-only + encoding unico.
 *
 * WHY: as decisoes de custo medidas no gates-proofs.md vivem nos .sh/.hooks
 * e podem regredir silenciosamente. Este guard trava cada uma com um
 * CONTRATO BIDIRECIONAL (mesmo padrao do par positivo/negativo do Gate 3):
 *
 * 1. GATE 3 MAPEADO (secao 8.4, medido 18s vs 178s ~10x): o Gate 3 do
 *    pre-push roda os testes das AREAS TOCADAS via pre-commit-tests.mjs
 *    --scope push, NAO a suite completa (test:unit, test:run, vitest run
 *    sem arquivos mapeados, bun run test em watch) - o CI roda a suite
 *    inteira em checkout fresco como rede. NEGATIVO: FULL_SUITE_RES em
 *    scripts/pre-push-gates.sh + .husky/pre-push. POSITIVO: o marcador
 *    pre-commit-tests.mjs --scope push em scripts/pre-push-gates.sh
 *    (deletar o Gate 3 = push sem testes = falha 'GATE 3 MISSING').
 *
 * 2. FUZZ:CI PRE-PUSH-ONLY (secao 8.4 nota 1, medido 53s = 71% do custo do
 *    push): o fuzz roda SO no pre-push (bun run fuzz:ci, o mesmo que o CI
 *    executa) - 53s num pre-commit destruiria o ciclo de commit. NEGATIVO:
 *    fuzz:ci/fuzz NAO pode aparecer no .husky/pre-commit. POSITIVO: fuzz:ci
 *    DEVE existir no .husky/pre-push (remover o gate = push sem fuzz que o
 *    CI rodaria = falha 'FUZZ GATE MISSING').
 *
 * 3. ENCODING GATE UNICO (medido ~1.4s): verify-encoding.sh (UTF-8 + VPS
 *    ASCII + proof + baseline) roda EM AMBOS os hooks - NAO pode ser
 *    trocado por check-utf8.sh (o bloco VPS_ASCII_FILES duplicado, que
 *    divergiu da surface real e foi removido) nem removido. NEGATIVO:
 *    check-utf8.sh fora de check-docs-encoding.sh nos hooks. POSITIVO:
 *    verify-encoding.sh DEVE existir em .husky/pre-commit E .husky/pre-push.
 *
 * Linhas de comentario (primeiro char nao-branco = '#') sao ignoradas no
 * scan NEGATIVO: os headers dos hooks mencionam "suite completa"/"fuzz" em
 * prosa (o header do pre-push explica POR QUE o bash runner ficou fora).
 * O scan POSITIVO varre o arquivo inteiro (o marcador pode estar em
 * qualquer linha).
 *
 * Env override PUSH_SUITE_SCAN_ROOT (repo sintetico p/ o vitest - espelha o
 * FRAGILE_SCAN_ROOT do fragile-range). Saida ASCII pura (gate file).
 * Puro node, sem deps, <10ms.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(process.env.PUSH_SUITE_SCAN_ROOT || process.cwd())
const FILES = ["scripts/pre-push-gates.sh", ".husky/pre-push", ".husky/pre-commit"]

/** Full-suite invocation patterns (the section-8.4 regression class). */
const FULL_SUITE_RES = [
  /test:unit\b/,
  /test:run\b/,
  /\bbun\s+run\s+test(?!:guard)\b/,
  /\bvitest\s+run\b/,
  /\bnpx\s+vitest\b/,
  /\bbunx\s+vitest\b/,
]

/** Required Gate-3 marker per guard file (the section-8.4 mapped invocation). */
const REQUIRED_MARKERS = [
  { file: "scripts/pre-push-gates.sh", re: /pre-commit-tests\.mjs\s+--scope\s+push/ },
]

/**
 * Gate-placement contracts (the bidirectional extension, 2026-08):
 * - negative: per-file patterns that MUST NOT appear (skip comments).
 * - positive: per-file markers that MUST exist somewhere (whole-file scan).
 */
const GATE_CONTRACTS = [
  {
    name: "fuzz:ci pre-push-only",
    negative: [{ file: ".husky/pre-commit", re: /\bfuzz:ci\b/ }],
    positive: [{ file: ".husky/pre-push", re: /bun\s+run\s+fuzz:ci/ }],
  },
  {
    name: "encoding gate unico",
    negative: [
      { file: ".husky/pre-commit", re: /check-utf8\.sh/ },
      { file: ".husky/pre-push", re: /check-utf8\.sh/ },
    ],
    positive: [
      { file: ".husky/pre-commit", re: /verify-encoding\.sh/ },
      { file: ".husky/pre-push", re: /verify-encoding\.sh/ },
    ],
  },
]

/** True when the line is a full-line comment (first non-space char is #). */
function isComment(line) {
  return /^\s*#/.test(line)
}

/**
 * Scan the guard files. Returns { fullSuite, missingMarker, gateViolations }
 * where fullSuite is [{ file, line, text }] of full-suite invocations,
 * missingMarker is [{ file }] for guard files lacking their required Gate-3
 * marker, and gateViolations is [{ kind, file, line, text }] of gate
 * contract violations (kind: 'negative' | 'positive-missing'). All empty =
 * clean. Exported for unit tests.
 */
export function scanPushFullSuite(root = ROOT, files = FILES) {
  const fullSuite = []
  for (const rel of files) {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) continue
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/)
    lines.forEach((line, i) => {
      if (isComment(line)) return
      for (const re of FULL_SUITE_RES) {
        if (re.test(line)) {
          fullSuite.push({ file: rel, line: i + 1, text: line.trim() })
          return
        }
      }
    })
  }
  const missingMarker = []
  for (const { file: rel, re } of REQUIRED_MARKERS) {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) continue // synthetic roots may omit the file
    if (!re.test(fs.readFileSync(abs, "utf8"))) missingMarker.push({ file: rel })
  }
  const gateViolations = []
  for (const contract of GATE_CONTRACTS) {
    for (const { file: rel, re } of contract.negative) {
      const abs = path.join(root, rel)
      if (!fs.existsSync(abs)) continue
      const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/)
      lines.forEach((line, i) => {
        if (isComment(line)) return
        if (re.test(line)) {
          gateViolations.push({
            kind: "negative",
            contract: contract.name,
            file: rel,
            line: i + 1,
            text: line.trim(),
          })
        }
      })
    }
    for (const { file: rel, re } of contract.positive) {
      const abs = path.join(root, rel)
      if (!fs.existsSync(abs)) continue
      if (!re.test(fs.readFileSync(abs, "utf8"))) {
        gateViolations.push({
          kind: "positive-missing",
          contract: contract.name,
          file: rel,
          line: 0,
          text: re.source,
        })
      }
    }
  }
  return { fullSuite, missingMarker, gateViolations }
}

function main() {
  const { fullSuite, missingMarker, gateViolations } = scanPushFullSuite()
  if (fullSuite.length === 0 && missingMarker.length === 0 && gateViolations.length === 0) {
    console.log(
      `push-suite: clean (${FILES.length} guard files, mapped Gate 3 present, no full-suite invocations, gate contracts ok)`,
    )
    return 0
  }
  for (const o of fullSuite) {
    console.log(`push-suite: FULL-SUITE in ${o.file}:${o.line}: ${o.text}`)
  }
  for (const m of missingMarker) {
    console.log(`push-suite: GATE 3 MISSING in ${m.file} (pre-commit-tests.mjs --scope push required, sec 8.4)`)
  }
  for (const v of gateViolations) {
    if (v.kind === "negative") {
      console.log(`push-suite: CONTRACT '${v.contract}' VIOLATED in ${v.file}:${v.line}: ${v.text}`)
    } else {
      console.log(`push-suite: CONTRACT '${v.contract}' MISSING in ${v.file} (${v.text})`)
    }
  }
  console.log(
    "push-suite: Gate 3 must run the MAPPED tests (pre-commit-tests.mjs --scope push), not the full suite (sec 8.4); fuzz:ci is pre-push-only (53s, sec 8.4); verify-encoding.sh is the single encoding gate in both hooks",
  )
  return 1
}

// Entry-point guard: only run the CLI when executed directly (vitest imports
// the file for unit tests of scanPushFullSuite without side effects).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
