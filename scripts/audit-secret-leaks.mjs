#!/usr/bin/env node
// =============================================================================
// audit-secret-leaks.mjs — Auditoria de segredos vazados no histórico do git
// =============================================================================
//
// Varre TODO o histórico (`git log -p --all`) procurando segredos expostos:
// chaves privadas (RSA/EC/OPENSSH/PGP), tokens (sk-*, GitHub, Slack, AWS) e
// atribuições de secrets em .env. Um segredo commitado uma vez fica no
// histórico PARA SEMPRE — mesmo após `git rm --cached` — então a única
// remediação real é ROTACIONAR o valor (veja scripts/rotate-secrets.mjs). Este
// script AUDITA o histórico para responder "quais commits expõem o quê".
//
// Por que não é um CI guard padrão: o histórico não muda em PRs normais
// (novos commits adicionam, não reescrevem). É uma ferramenta de operação:
// rodar após onboarding / antes de tornar o repo público / no incident
// response de vazamento. O `--check` existe para uso em pipelines que exigem
// exit-code (ex.: um job de auditoria agendado), mas o fluxo normal é o
// operador ler o relatório e decidir a rotação.
//
// Segurança do output: NUNCA imprime o segredo completo — só os primeiros 8
// caracteres + "…" (mask). Commit hash e caminho do arquivo são impressos
// para localizar o vazamento.
//
// Fixtures de teste (ex.: sk-test-..., ghp_test_..., arquivos .example /
// __tests__ / test-fixtures) são IGNORADOS por padrão — use --include-tests
// para auditá-los também.
//
// Usage:
//   node scripts/audit-secret-leaks.mjs                      # audita tudo
//   node scripts/audit-secret-leaks.mjs --since origin/main  # só commits novos
//   node scripts/audit-secret-leaks.mjs --max-count 100      # limita commits
//   node scripts/audit-secret-leaks.mjs --json               # output JSON
//   node scripts/audit-secret-leaks.mjs --check              # exit 1 se achar
//   node scripts/audit-secret-leaks.mjs --include-tests      # inclui fixtures
//   node scripts/audit-secret-leaks.mjs --help
//
// Exit codes:
//   0 — nenhum segredo encontrado (ou auditoria concluída sem --check)
//   1 — segredos encontrados E --check ativo (fail-closed)
//   2 — erro técnico (git indisponível / não é repo git / flag inválida)
// =============================================================================

import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

// ── Padrões de segredos ───────────────────────────────────────────────────
// Cada entrada: { id, severity, re } — o regex DEVE capturar um grupo (a parte
// a mascarar). Adicionar um padrão novo = adicionar uma linha aqui.
// severity: "alta" | "média" | "baixa" — consumida pelo guard semanal
// (check-secret-leaks-baseline.mjs) no filtro --min-severity, que só RELAXA o
// gate: o default falha em QUALQUER achado novo, de qualquer severidade.

/** Chaves privadas (header PEM ou corpo base64 do OPENSSH). — severidade ALTA */
const PRIVATE_KEY_RE = {
  id: "chave privada",
  severity: "alta",
  re: /(-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|-----BEGIN OPENSSH PRIVATE KEY-----|-----BEGIN PGP PRIVATE KEY BLOCK-----)/,
}

/** Tokens com prefixo reconhecível (mín. 16 chars de payload). — severidade ALTA */
const PREFIX_TOKEN_RE = {
  id: "token com prefixo",
  severity: "alta",
  re: /\b(sk-[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9]{16,}|sk-proj-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|gho_[A-Za-z0-9]{36,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/,
}

/** Atribuições de secrets em .env / código (chave conhecida + valor não-trivial). — severidade MÉDIA */
const SECRET_ASSIGN_RE = {
  id: "atribuição de secret",
  severity: "média",
  re: /\b(SESSION_SECRET|DB_PASSWORD|POSTGRES_PASSWORD|DATABASE_URL|DIRECT_URL|SECRET_KEY|API[_-]?KEY|ACCESS_KEY|SECRET_ACCESS_KEY|CLIENT_SECRET|PRIVATE_KEY|TOKEN|PASSWORD|PASSWD)\b[^\n=]{0,20}=["']?([^"'\s]{12,})/,
}

/** Arquivos de fixture/exemplo que contêm segredos FALSOS (teste) — ignorados por padrão. */
function isFixturePath(filePath) {
  const p = filePath.toLowerCase()
  return (
    p.includes("__tests__") ||
    p.includes("test-fixtures") ||
    p.includes("test/") ||
    p.endsWith(".example") ||
    p.includes(".example.") ||
    p.includes(".fixture.") ||
    p.includes("/fixtures/") ||
    p.includes("mock")
  )
}

// ── Parser de `git log -p` ────────────────────────────────────────────────

/**
 * Extrai o caminho do arquivo de uma linha `diff --git a/... b/...` (escapa
 * os prefixos a/ b/; paths com espaços vêm entre aspas: "a/my file.sh").
 * Alternância quoted/unquoted para cada lado — um `(.*)` guloso quebraria
 * paths quoted com espaços (bug real pego em teste).
 */
export function parseDiffPath(line) {
  const m = line.match(/^diff --git (?:"a\/([^"]*)"|a\/([^\s"]*)) (?:"b\/([^"]*)"|b\/([^\s"]*))$/)
  if (!m) return null
  return m[3] ?? m[4] ?? m[1] ?? m[2]
}

/**
 * Interpreta um header de hunk `@@ -a,b +c,d @@` — devolve o número da
 * primeira linha ADICIONADA no arquivo novo.
 */
export function parseHunkHeader(line) {
  const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
  return m ? Number(m[1]) : null
}

/**
 * Varre o texto bruto de `git log -p --all` e devolve os achados.
 * Só linhas ADICIONADAS ('+') são candidatas (a remoção de um secret já não
 * expõe mais nada — o commit que ADICIONOU é o relevante).
 *
 * @param {string} logPatch  saída de git log -p --all
 * @param {{ includeTests?: boolean, patterns?: object[] }} opts
 * @returns {Array<{commit: string, file: string, line: number, id: string,
 *                  severity: string, masked: string, key?: string}>}
 */
export function scanHistory(logPatch, opts = {}) {
  const { includeTests = false, patterns } = opts
  const allPatterns = patterns ?? [PRIVATE_KEY_RE, PREFIX_TOKEN_RE, SECRET_ASSIGN_RE]

  const findings = []
  let commit = null
  let file = null
  let lineNo = 0

  for (const rawLine of logPatch.split(/\r?\n/)) {
    if (rawLine.startsWith("commit ")) {
      commit = rawLine.slice(7).split(/\s/)[0]
      file = null
      lineNo = 0
      continue
    }
    if (rawLine.startsWith("diff --git ")) {
      file = parseDiffPath(rawLine)
      lineNo = 0
      continue
    }
    if (rawLine.startsWith("@@ ")) {
      const start = parseHunkHeader(rawLine)
      if (start !== null) lineNo = start - 1 // o loop soma 1 por linha de hunk
      continue
    }
    if (!commit || !file) continue
    if (file.startsWith("a/") || file.startsWith("b/")) file = file.slice(2)
    if (!includeTests && isFixturePath(file)) continue

    const ch = rawLine[0]
    if (ch === "+") {
      lineNo++
      const content = rawLine.slice(1)
      for (let i = 0; i < allPatterns.length; i++) {
        const pat = allPatterns[i]
        // Backward-compat: aceita tanto o formato NOVO ({id, severity, re})
        // quanto o ANTIGO (regex cru passado via opts.patterns) — pat.re ?? pat.
        const re = pat.re ?? pat
        const m = content.match(re)
        if (!m) continue
        // Convenção de grupos: m[1] = CHAVE (ex.: DB_PASSWORD), m[2] = VALOR
        // — mas só quando o padrão tem 2 grupos. Padrões de 1 grupo (token
        // com prefixo, chave privada) têm o SEGREDO em m[1]: usá-lo como key
        // vazaria o valor completo no output (bug real pego em review).
        const hasValue = m.length > 2 && m[2] !== undefined
        const key = hasValue ? m[1] : null
        const value = m[2] ?? m[1] ?? m[0]
        findings.push({
          commit,
          file,
          line: lineNo,
          id: pat.id,
          severity: pat.severity,
          masked: maskSecret(value),
          key,
        })
        break // uma linha → um achado (evita spam de múltiplos padrões)
      }
    }
    // linhas '-' e de contexto não incrementam lineNo
  }
  return findings
}

// ── Helpers ───────────────────────────────────────────────────────────────

function maskSecret(s) {
  return s.length <= 8 ? "********" : `${s.slice(0, 4)}…${s.length} chars`
}

// ── Main / CLI ────────────────────────────────────────────────────────────

const HELP = `audit-secret-leaks.mjs — Varre o histórico do git por segredos vazados

USO:
  node scripts/audit-secret-leaks.mjs                     audita todo o histórico
  node scripts/audit-secret-leaks.mjs --since origin/main apenas commits novos
  node scripts/audit-secret-leaks.mjs --max-count 100     limita o número de commits
  node scripts/audit-secret-leaks.mjs --json              saída JSON (máquina)
  node scripts/audit-secret-leaks.mjs --check             exit 1 se encontrar segredos
  node scripts/audit-secret-leaks.mjs --include-tests     inclui fixtures/testes
  node scripts/audit-secret-leaks.mjs --help

PADRÕES DETECTADOS (com severidade p/ o guard semanal):
  - chaves privadas (RSA / EC / OPENSSH / PGP) — severidade ALTA
  - tokens com prefixo (sk-*, sk_live_*, sk-proj-*, ghp_*, github_pat_*, xox*,
    AKIA*) — severidade ALTA
  - atribuições de secrets (SESSION_SECRET=, DB_PASSWORD=, API_KEY=, TOKEN=, …)
    — severidade MÉDIA

SEVERIDADE: cada achado carrega severity (alta/média/baixa) no JSON. O guard
semanal (check-secret-leaks-baseline.mjs) roda SEM --min-severity: o default é
falhar em QUALQUER achado NOVO, qualquer severidade. --min-severity alta existe
para RELAXAR o gate deliberadamente (tolerar ruído médio), nunca para apertá-lo
— usá-lo no job semanal ENFRAQUECERIA o gate.

SEGURANÇA: o output mascarada os segredos (8 primeiros chars + "…"). Para
remediar um achado, ROTACIONE o valor (scripts/rotate-secrets.mjs) — apagar do
working tree não remove do histórico.
`

function main() {
  const args = process.argv.slice(2)
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP)
    process.exit(0)
  }

  const check = args.includes("--check")
  const json = args.includes("--json")
  const includeTests = args.includes("--include-tests")

  const maxCountIdx = args.indexOf("--max-count")
  const maxCount = maxCountIdx !== -1 ? Number(args[maxCountIdx + 1]) : null
  if (maxCountIdx !== -1 && (!Number.isInteger(maxCount) || maxCount <= 0)) {
    console.error("audit-secret-leaks: --max-count requer um inteiro positivo")
    process.exit(2)
  }

  const sinceIdx = args.indexOf("--since")
  const since = sinceIdx !== -1 ? args[sinceIdx + 1] : null

  // git log -p --all [--since X] [--max-count N]
  const gitArgs = ["log", "-p", "--all"]
  if (since) gitArgs.push(`--since=${since}`)
  if (maxCount) gitArgs.push("--max-count", String(maxCount))

  let patch
  try {
    patch = execFileSync("git", gitArgs, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
  } catch {
    console.error(
      "audit-secret-leaks: git log falhou — não é um repositório git ou git indisponível",
    )
    process.exit(2)
  }

  const findings = scanHistory(patch, { includeTests })

  if (json) {
    console.log(JSON.stringify({ count: findings.length, findings }, null, 2))
    process.exit(check && findings.length > 0 ? 1 : 0)
  }

  if (findings.length === 0) {
    console.log("🔒 audit-secret-leaks: nenhum segredo encontrado no histórico.")
    process.exit(0)
  }

  console.log(`🔓 audit-secret-leaks: ${findings.length} possível(is) segredo(s) no histórico:\n`)
  for (const f of findings) {
    console.log(
      `   • ${f.commit.slice(0, 12)}  ${f.file}:${f.line}  [${f.id}]  ${f.masked}` +
        (f.key ? `  (chave: ${f.key})` : ""),
    )
  }
  console.log(
    `\n⚠️  Segredos no histórico NÃO somem com git rm — ROTACIONE os valores` +
      `\n   (node scripts/rotate-secrets.mjs) antes de tornar o repo público.`,
  )
  process.exit(check ? 1 : 0)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
