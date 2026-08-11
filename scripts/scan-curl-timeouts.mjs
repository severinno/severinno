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
 * FORMAS DE INVOCACAO (a superficie medida, sec 11.31): o detector
 * reconhece SOMENTE o token literal `curl` + a flag literal `--max-time`.
 *   - Forma curta `-m 20`: NAO e reconhecida - over-flags (direcao segura:
 *     custa o mesmo --max-time explicito; a forma longa e o canone).
 *   - Case-variante (`--MAX-TIME` / `--Max-Time`): NAO casa - o
 *     MAX_TIME_RE e case-sensitive (sem flag i, sec 11.31); OVER-FLAGS
 *     (direcao segura, mesma classe de custo do -m) E a forma tambem e
 *     erro do curl (opcoes longas sao case-sensitive: 'option --MAX-TIME:
 *     is unknown' -> fail-loud exit 2, nunca um hang) - nao existe
 *     spelling que bound o total E escape o regex (o under-flag
 *     hipotetico nao existe; CURL_INVOKE_RE segue o mesmo principio - um
 *     `CURL` maiusculo nao e comando valido, falha na hora).
 *   - Wrapper (`curl2() { curl ...; }`): o token real vive no CORPO da
 *     funcao, entao o DEF e o chokepoint - um wrapper SEM --max-time no
 *     corpo falha exatamente onde o bound pertence; com a flag, passa (a
 *     indirecao segura e permitida). O CALL (`curl2 ...`) e invisivel ao
 *     regex (curl2 nao casa \bcurl\b) mas o DEF ja guarda o script.
 *   - `--connect-timeout` SOZINHO: FALHA POR DECISAO (sec 11.31) - ele
 *     bounds apenas a fase de connect; um stall de corpo pos-connect ainda
 *     penduraria o CI. So o --max-time bounds o TOTAL, que e a classe-killer.
 *   - `alias curl='curl --max-time 20'`: o token NOME do alias (fora da
 *     string) over-flags - direcao segura, mesmo custo.
 *   - `command -v curl`: excluido explicitamente (probe de existencia).
 *   - Caminho absoluto / `env` (a premissa INVERTIDA, sec 11.31): o probe
 *     2026-08-11 provou que `/usr/bin/curl` e `env curl` CASAM o \bcurl\b
 *     (a borda de palavra vale na `/` e no espaco) - COBERTO, sem under-
 *     flag por forma de caminho. O ESCAPE real e o token QUOTADO
 *     (`"/usr/bin/curl"`, `"$(command -v curl)"`): o maskBashStrings
 *     consome a string e o token some - a classe irma do eval (11.30) SEM
 *     o trigger `eval` (o tripwire 11.36 nao pega); fronteira ACEITA (0
 *     usos quotados na superficie derivada - health-check.sh e test-
 *     security-headers.sh invocam curl bare; fechar custa parsing de
 *     posicao de comando quotado, a mesma classe de custo que a 11.30
 *     recusou).
 *   - A MATRIZ e exclusiva DESTA superficie (sec 11.38, MEDIDO): o scan-
 *     timeouts compartilha a filosofia masking+fronteira+over-flag-safe,
 *     mas NAO tem matriz de formas - a classe de variantes dele e
 *     INDIRECAO (token atras de outro nome, via helpers locais/importados),
 *     nao same-token spelling. A tabela de 19 formas existe aqui porque o
 *     bash constroi comandos por TEXTO (forma curta, case, alias, env,
 *     path, quoting) - uma superficie de FORMAS rica que a JS test surface
 *     nao tem. Cada detector mantem a matriz propria por construcao.
 *
 * O TRIPWIRE (sec 11.36 do gates-proofs.md) - o early-warning da fronteira
 * 11.30: o falso-negativo do `eval` (`CMD="curl ..."; eval "$CMD"` - o token
 * curl vive DENTRO da string, o maskBashStrings o consome, o detector
 * --max-time nao o ve) e ACEITO POR DECISAO (o custo de rastrear eval de
 * strings e alto demais para uma forma com 0 usos na superficie). Mas a
 * fronteira decidida nao pode virar um buraco silencioso: SE um dia a forma
 * aparecer, ninguem seria avisado. ESTE guard fecha esse gap com um
 * tripwire BARATO e ORTOGONAL ao detector: um grep ASCII por `eval` +
 * `curl` na MESMA linha logica (continuacoes `\` unidas) de um gate
 * script, que FALHA (exit 1) com aviso quando a forma aparecer. O detector
 * --max-time NAO e fechado (o scanGateScript segue retornando [] para o
 * token mascarado); o tripwire e uma checagem SEPARADA (scanEvalCurl) que
 * convive com ele - o sinal `EVAL CURL (sec 11.30)` exige a DECISAO humana
 * (refatorar para invocacao direta com --max-time OU documentar
 * formalmente), em vez de deixar o escape entrar sem ruido.
 *
 * Fronteiras do tripwire (documentadas na sec 11.36, barato POR DESIGN):
 *   - Form-based: um --max-time DENTRO da string eval'd ainda trip (a
 *     checagem estatica nao pode verificar o conteudo mascarado - o aviso
 *     e sobre a FORMA, nao sobre a flag).
 *   - Linha logica: so a forma na MESMA linha logica trip; `CMD="curl..."`
 *     numa linha e `eval "$CMD"` noutra (sem continuacao) NAO trip -
 *     fechar isso custa rastreamento de variaveis, o MESMO custo que a
 *     11.30 recusou (0 usos hoje; a fronteira residual fica nomeada).
 *   - Linhas de comentario sao excluidas; SEM masking (o masking mataria o
 *     proprio sinal - o token vive na string). Prosa em strings
 *     mencionando os dois tokens over-flags (direcao segura, mesmo custo
 *     do detector).
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

/** The tripwire token (sec 11.36): an `eval` on the same LOGICAL line as a curl. */
const EVAL_TOKEN_RE = /\beval\b/

/** The contract flag: bounds the TOTAL time (the class-killer). */
const MAX_TIME_RE = /--max-time\b/

/**
 * FRONTIERS - o guard dos guards de fronteira (sec 11.40 do gates-proofs.md):
 * TODA forma de invocacao que o detector deliberadamente NAO trata como
 * violacao do contrato (ou trata de forma decidida) precisa de uma pinagem
 * estrutural - um tripwire (o early-warning da forma aceita) OU um teste de
 * contrafactual pinado (o detector funciona nos dois lados da decisao). Este
 * manifest enumera a superficie DECIDIDA-ACEITA com a classe de protecao de
 * cada fronteira, para um refactor futuro nao dropar um pin sem o contrato
 * travar (o mesmo padrao do scan-batch-coverage / manifest-registry).
 *
 * kind: escape (passa silencioso - exige tripwire OU counterfactual),
 *       overflag (direcao segura: falha alto, custa o mesmo --max-time),
 *       covered (o probe inverteu a premissa: o token casa na borda),
 *       excluded (probe de existencia / regra explicita),
 *       fail-decision (FALHA POR DECISAO - nunca passa).
 * protection: tripwire (scanEvalCurl), counterfactual (it dedicado com o
 *       contrafactual embutido no MESMO teste), matrix (linha da matriz
 *       INVOCATION-FORM com expected 0/1).
 * marker: o substring EXATO que a suite de testes deve conter para o pin ser
 *       real (o contrato le o proprio test file e falha se o marker sumir).
 * ref: a secao do gates-proofs.md que decidiu a fronteira.
 * ASCII puro (gate file).
 */
export const FRONTIERS = [
  { id: "eval-built-curl", kind: "escape", protection: "tripwire", marker: "TRIPWIRE (sec 11.36): the eval+curl FORM", ref: "11.30/11.36" },
  { id: "quoted-token", kind: "escape", protection: "counterfactual", marker: "QUOTED absolute path - ESCAPE ACEITO", ref: "11.31" },
  { id: "split-form-eval", kind: "escape", protection: "counterfactual", marker: "SEPARATE physical lines", ref: "11.36" },
  { id: "short-form-m", kind: "overflag", protection: "matrix", marker: "short form -m 20 OVER-FLAGS", ref: "11.31" },
  { id: "case-variant", kind: "overflag", protection: "matrix", marker: "case-variant --MAX-TIME OVER-FLAGS", ref: "11.31" },
  { id: "alias-name", kind: "overflag", protection: "matrix", marker: "alias curl=", ref: "11.31" },
  { id: "curl-bin-assignment", kind: "overflag", protection: "matrix", marker: "CURL_BIN=curl", ref: "header" },
  { id: "wrapper-indirection", kind: "overflag", protection: "matrix", marker: "wrapper DEF without bound", ref: "11.31" },
  { id: "connect-timeout-alone", kind: "fail-decision", protection: "matrix", marker: "--connect-timeout ALONE FAILS", ref: "11.31" },
  { id: "absolute-path", kind: "covered", protection: "matrix", marker: "absolute path - COBERTO", ref: "11.31" },
  { id: "env-wrapper", kind: "covered", protection: "matrix", marker: "env wrapper - COBERTO", ref: "11.31" },
  { id: "health-url-variable", kind: "covered", protection: "counterfactual", marker: "MUTATION (the $HEALTH_URL incident pattern)", ref: "11.29" },
  { id: "command-v-probe", kind: "excluded", protection: "matrix", marker: "command -v curl probe", ref: "11.31" },
  { id: "command-v-assignment", kind: "excluded", protection: "matrix", marker: "command -v ASSIGNMENT", ref: "11.31" },
]

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
 * The TRIPWIRE (sec 11.36) - scan a single gate script for the `eval` +
 * `curl` form on the SAME logical line. Returns [{ line, text }] where line
 * is 1-based (the START line of the logical command). This is the
 * early-warning of the 11.30 frontier: the --max-time detector does NOT see
 * the eval-built curl (the token lives inside the string, consumed by
 * maskBashStrings) - the ACCEPTED false-negative stays. The tripwire is
 * ORTHOGONAL: it fails with a warning when the FORM appears, forcing a
 * human decision instead of a silent escape. No masking BY DESIGN (masking
 * would consume the very token this check exists to warn about); comment
 * lines excluded (the cheap, consistent rule). Exported for tests; root
 * defaults to the module ROOT (mirrors scanGateScript's callers).
 */
export function scanEvalCurl(relPath, root = ROOT) {
  const abs = path.join(root, relPath)
  if (!fs.existsSync(abs)) return []
  const raw = fs.readFileSync(abs, "utf8")
  const warnings = []
  const logicalLines = joinContinuations(raw.split("\n"))
  let baseLine = 1
  for (const logical of logicalLines) {
    if (isCommentLine(logical)) {
      baseLine += logical.split("\n").length
      continue
    }
    if (EVAL_TOKEN_RE.test(logical) && CURL_INVOKE_RE.test(logical)) {
      warnings.push({
        line: baseLine,
        text: logical.trim().slice(0, 80),
      })
    }
    baseLine += logical.split("\n").length
  }
  return warnings
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
 * Scan the whole CI gate-script surface. Returns
 * { files, violations, evalWarnings }. The derived names are the BASENAMES
 * captured by the workflow regex (`scripts/<name>.sh` -> `<name>.sh`); they
 * are resolved back under `scripts/` here - a derived name must always map
 * to a real gate script (the BASELINE companion pins that no derived name
 * is a dead path: a vacuous pass would mean a NEW gate script was never
 * actually scanned, the exact false-clean class this guard exists to kill).
 * evalWarnings is the TRIPWIRE surface (sec 11.36): the eval+curl form on a
 * logical line - ORTHOGONAL to violations (the --max-time detector is NOT
 * closed; the accepted false-negative of 11.30 stays, the form now trips a
 * warning).
 */
export function scanCurlTimeouts(root = ROOT) {
  const files = deriveGateScripts(root)
  const violations = []
  const evalWarnings = []
  for (const rel of files) {
    const gateRel = `scripts/${rel}`
    for (const v of scanGateScript(gateRel, root)) {
      violations.push({ file: gateRel, line: v.line, text: v.text })
    }
    for (const w of scanEvalCurl(gateRel, root)) {
      evalWarnings.push({ file: gateRel, line: w.line, text: w.text })
    }
  }
  return { files, violations, evalWarnings }
}

export function main() {
  const args = process.argv.slice(2)
  const unknown = args.filter((a) => a.startsWith("--") && a !== "--ci")
  if (unknown.length > 0) {
    process.stderr.write("curl-timeouts: usage: node scripts/scan-curl-timeouts.mjs [--ci]\n")
    return 2
  }
  const { files, violations, evalWarnings } = scanCurlTimeouts()
  if (violations.length === 0 && evalWarnings.length === 0) {
    process.stdout.write(
      `curl-timeouts: clean (${files.length} gate script(s) from workflows, every curl has --max-time and no eval+curl form - sec security-headers-gate ADOTADO / 11.36)\n`,
    )
    return 0
  }
  // Failures go to STDERR (the sibling scan-timeouts convention): CI
  // steps that pipe stdout would otherwise swallow the exact file:line
  // that the fix depends on.
  if (violations.length > 0) {
    process.stderr.write(
      `curl-timeouts: ${violations.length} curl invocation(s) WITHOUT --max-time in CI gate scripts (a stalled curl hung CI for 9:08 in run 31430040398 - add --max-time 20, sec security-headers-gate-2026-08):\n`,
    )
    for (const v of violations) {
      process.stderr.write(`  CURL WITHOUT --max-time in ${v.file}:${v.line}: ${v.text}\n`)
    }
    process.stderr.write(
      "curl-timeouts: sec security-headers-gate-2026-08 - todo curl em gate script de CI precisa de --max-time (--connect-timeout recomendado); scripts locais/ops ficam fora da superficie por design\n",
    )
  }
  if (evalWarnings.length > 0) {
    process.stderr.write(
      `curl-timeouts: ${evalWarnings.length} eval+curl form(s) em linha logica de gate script (o token curl vive na string e ESCAPA do detector --max-time - fronteira sec 11.30; o tripwire sec 11.36 falha para forcar a decisao: refatore para invocacao direta com --max-time OU documente formalmente):\n`,
    )
    for (const w of evalWarnings) {
      process.stderr.write(`  EVAL CURL (sec 11.30) in ${w.file}:${w.line}: ${w.text}\n`)
    }
    process.stderr.write(
      "curl-timeouts: sec 11.36 - o tripwire e sobre a FORMA (eval+curl na mesma linha logica), nao sobre a flag; a fronteira do detector --max-time continua aceita por decisao (11.30)\n",
    )
  }
  return 1
}

// Entry-point guard: only run the CLI when executed directly (vitest imports
// the module for unit tests of the pure functions without side effects).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
