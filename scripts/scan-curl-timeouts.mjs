#!/usr/bin/env node
/**
 * scan-curl-timeouts.mjs - guard do veredito ADOTADO do
 * docs/security-headers-gate-2026-08.md (2026-08-10): TODO curl em gate
 * script de CI precisa de --max-time.
 *
 * WHY THIS EXISTS (read before you skip it):
 *   Em 2026-08 o job security-headers do pr-check.yml dominava o tail de
 *   TODA prova (9:08 no run 31430040398, sec 11.20 do gates-proofs.md). A
 *   medicao 2026-08-10 mostrou que o site responde em ~200ms - o tail NAO
 *   era lentidao do host, era o curl do script test-security-headers.sh
 *   SEM --max-time/--connect-timeout: um connect stall (HTTP 000000 no log)
 *   deixava o job esperando minutos em todo trigger (PR, merge_group,
 *   workflow_dispatch de prova). O fix padronizou --max-time 20
 *   --connect-timeout 10 nos curls dos gate scripts; ESTE guard e o fix
 *   tornado permanente - um curl novo SEM --max-time num gate script de CI
 *   reintroduz a classe e falha com o caminho exato.
 *
 * O CONTRATO (bidirecional, mesmo padrao do scan-timeouts / scan-push-full-
 * suite):
 *   - NEGATIVO: uma invocacao de curl (linha logica, continuacoes `\`
 *     unidas) num gate script de CI sem --max-time = falha com file:line.
 *     --connect-timeout e RECOMENDADO (bounds a fase de connect) mas nao
 *     exigido - o --max-time ja bounds o total, que e o que mata a classe.
 *   - POSITIVO: a superficie escaneada NAO pode ser vazia - os gate scripts
 *     DERIVADOS dos workflows (o padrao SPREAD dos TARGET_DIRS): um script
 *     .sh novo referenciado por um workflow entra automaticamente no scan,
 *     e um detector que nao casa nada seria um pass vacuo (o BASELINE
 *     companion pina files > 0).
 *
 * SUPERFICIE (o que e um "gate script de CI"): os .sh referenciados pelos
 * .github/workflows/*.yml (derivacao viva, mesma filosofia do encoding-
 * surface). Scripts locais/ops (deploy.sh, setup.sh, diagnose-*, etc.) NAO
 * sao CI gates - ficam fora da superficie POR DESIGN (um curl local que
 * trava e um problema do dev, nao um stall de CI; e a maioria tem outros
 * guards de rede). Um script novo entra no scan ao ser citado num
 * workflow - sem editar este guard (o padrao de crescimento dos TARGET_DIRS).
 *
 * MASKING (a precisao): linhas de comentario e STRINGS bash ("..."/'...')
 * sao mascaradas antes da checagem - `fail "curl falhou"`, `command -v
 * curl` e `echo "...via curl..."` NAO podem false-positivar; so a invocacao
 * real de curl (token fora de string) conta. Continuacoes de linha (`\`)
 * sao unidas para o --max-time valer na linha logica inteira (o TLS check
 * do test-security-headers.sh poe o --max-time na linha de continuacao).
 * Fronteira conhecida do masking: `which curl` e uma atribuicao tipo
 * `CURL_BIN=curl` (token fora de string) FALSE-positivariam - nenhum gate
 * script do repo usa essas formas hoje; se um dia aparecer, o detector
 * ganha o caso (over-flagging so custa um --max-time explicito, o mesmo
 * custo seguro do scan-timeouts).
 *
 * Env override CURL_TIMEOUTS_SCAN_ROOT (repo sintetico p/ o vitest - espelha
 * o TIMEOUT_SCAN_ROOT do scan-timeouts). Saida ASCII pura (gate file). Puro
 * node, sem deps, <10ms.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(process.env.CURL_TIMEOUTS_SCAN_ROOT || process.cwd())
const WORKFLOWS_DIR = path.join(".github", "workflows")

/** A reference to a gate script inside a workflow: `scripts/X.sh` (incl. `./scripts/`). */
const SCRIPT_REF_RE = /scripts\/([A-Za-z0-9._-]+\.sh)/g

/** A real curl invocation: the token `curl` NOT inside a masked string. */
const CURL_INVOKE_RE = /\bcurl\b/

/** `command -v curl` (existence probe, not an invocation). */
const COMMAND_V_CURL_RE = /\bcommand\s+-v\s+curl\b/

/** The contract flag: bounds the TOTAL time (the class-killer). */
const MAX_TIME_RE = /--max-time\b/

/**
 * Mask bash double/single-quoted strings (contents become spaces, quotes
 * stay), so prose that merely MENTIONS curl inside a string cannot flag a
 * line. Escapes inside double quotes are consumed. Comments are handled at
 * line level by the caller (a `#` inside a string is masked to space).
 */
export function maskBashStrings(src) {
  let out = ""
  let mode = null // '"' | "'"
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (mode === '"') {
      if (ch === "\\") {
        out += "  "
        i++
        continue
      }
      if (ch === '"') {
        mode = null
        out += '"'
        continue
      }
      out += " "
    } else if (mode === "'") {
      if (ch === "'") {
        mode = null
        out += "'"
        continue
      }
      out += " "
    } else if (ch === '"' || ch === "'") {
      mode = ch
      out += ch
    } else {
      out += ch
    }
  }
  return out
}

/** Join backslash-continuation lines into logical command lines. */
export function joinContinuations(lines) {
  const out = []
  let current = ""
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "")
    const isContinuation = /\\\s*$/.test(line)
    current = current === "" ? line : `${current}\n${line}`
    if (!isContinuation) {
      out.push(current)
      current = ""
    }
  }
  if (current !== "") out.push(current)
  return out
}

/** True when the (already masked) line is a comment (first non-space is #). */
function isCommentLine(maskedLine) {
  return /^\s*#/.test(maskedLine)
}

/**
 * Scan a single gate script for curl invocations without --max-time.
 * Returns [{ line, text }] where line is 1-based (the START line of the
 * logical command). Exported for tests; root defaults to the module ROOT
 * (the synthetic-root suites pass their fixture dir explicitly - the same
 * fixture-driven pattern as scanGateScript's callers in scanCurlTimeouts).
 */
export function scanGateScript(relPath, root = ROOT) {
  const abs = path.join(root, relPath)
  if (!fs.existsSync(abs)) return []
  const raw = fs.readFileSync(abs, "utf8")
  const violations = []
  const logicalLines = joinContinuations(raw.split("\n"))
  let baseLine = 1
  for (const logical of logicalLines) {
    const masked = maskBashStrings(logical)
    if (isCommentLine(masked)) {
      baseLine += logical.split("\n").length
      continue
    }
    const hasInvocation = CURL_INVOKE_RE.test(masked) && !COMMAND_V_CURL_RE.test(masked)
    if (hasInvocation && !MAX_TIME_RE.test(masked)) {
      violations.push({
        line: baseLine,
        text: logical.trim().slice(0, 80),
      })
    }
    baseLine += logical.split("\n").length
  }
  return violations
}

/**
 * Derive the CI gate scripts from the workflows (the SPREAD direction: a new
 * .sh cited by a workflow is auto-covered). Returns [] when the workflows
 * dir is absent (minimal synthetic root).
 */
export function deriveGateScripts(root = ROOT) {
  const wfDir = path.join(root, WORKFLOWS_DIR)
  if (!fs.existsSync(wfDir)) return []
  const found = new Set()
  for (const f of fs.readdirSync(wfDir)) {
    if (!/\.ya?ml$/.test(f)) continue
    const raw = fs.readFileSync(path.join(wfDir, f), "utf8")
    for (const m of raw.matchAll(SCRIPT_REF_RE)) found.add(m[1])
  }
  return [...found].sort()
}

/**
 * Scan the whole CI gate-script surface. Returns { files, violations }.
 * The derived names are the BASENAMES captured by the workflow regex
 * (`scripts/<name>.sh` -> `<name>.sh`); they are resolved back under
 * `scripts/` here - a derived name must always map to a real gate script
 * (the BASELINE companion pins that no derived name is a dead path: a
 * vacuous pass would mean a NEW gate script was never actually scanned,
 * the exact false-clean class this guard exists to kill).
 */
export function scanCurlTimeouts(root = ROOT) {
  const files = deriveGateScripts(root)
  const violations = []
  for (const rel of files) {
    const gateRel = `scripts/${rel}`
    for (const v of scanGateScript(gateRel, root)) {
      violations.push({ file: gateRel, line: v.line, text: v.text })
    }
  }
  return { files, violations }
}

export function main() {
  const args = process.argv.slice(2)
  const unknown = args.filter((a) => a.startsWith("--") && a !== "--ci")
  if (unknown.length > 0) {
    process.stderr.write("curl-timeouts: usage: node scripts/scan-curl-timeouts.mjs [--ci]\n")
    return 2
  }
  const { files, violations } = scanCurlTimeouts()
  if (violations.length === 0) {
    process.stdout.write(
      `curl-timeouts: clean (${files.length} gate script(s) from workflows, every curl has --max-time - sec security-headers-gate ADOTADO)\n`,
    )
    return 0
  }
  // Violations go to STDERR (the sibling scan-timeouts convention): CI
  // steps that pipe stdout would otherwise swallow the exact file:line
  // that the fix depends on.
  process.stderr.write(
    `curl-timeouts: ${violations.length} curl invocation(s) WITHOUT --max-time in CI gate scripts (a stalled curl hung CI for 9:08 in run 31430040398 - add --max-time 20, sec security-headers-gate-2026-08):\n`,
  )
  for (const v of violations) {
    process.stderr.write(`  CURL WITHOUT --max-time in ${v.file}:${v.line}: ${v.text}\n`)
  }
  process.stderr.write(
    "curl-timeouts: sec security-headers-gate-2026-08 - todo curl em gate script de CI precisa de --max-time (--connect-timeout recomendado); scripts locais/ops ficam fora da superficie por design\n",
  )
  return 1
}

// Entry-point guard: only run the CLI when executed directly (vitest imports
// the module for unit tests of the pure functions without side effects).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
