#!/usr/bin/env node
// =============================================================================
// check-secret-leaks-baseline.mjs — Guard semanal: segredos NOVOS no histórico
// =============================================================================
//
// Roda o audit-secret-leaks.mjs (git log -p --all) e compara os achados com
// um BASELINE commitado (docs/security/secret-leaks-baseline.json). Falha
// (exit 1) SOMENTE se achados NOVOS aparecerem — o baseline documenta os
// vazamentos JÁ conhecidos do histórico. Um segredo NOVO commitado depois
// do baseline vira falha no job semanal, alertando sobre vazamentos futuros
// antes de virarem incidente.
//
// Por que baseline e não zero: o histórico JÁ tem vazamentos conhecidos
// (141 em 2026-08 — a remediação é filter-repo + rotação, uma operação
// deliberada, não CI). O guard protege o FUTURO. O count do baseline é
// DERIVADO do audit real (nunca literal) — `--update` regenera o arquivo,
// então o número não fica hardcoded (mesmo princípio do badge de encoding
// guards e do check-e2e-counts).
//
// Comparação por ASSINATURA (commit+file+line+id+key), não por count: uma
// linha removida e outra adicionada mantém o count, mas a assinatura NOVA é
// detectada. Findings REMOVIDOS (ex.: história reescrita com filter-repo)
// NÃO falham — só os novos. Fail-closed: baseline ausente sem --update =
// exit 2 com instrução clara.
//
// Usage:
//   node scripts/check-secret-leaks-baseline.mjs                     # check
//   node scripts/check-secret-leaks-baseline.mjs --update            # regenera baseline
//   node scripts/check-secret-leaks-baseline.mjs --baseline X        # path custom
//   node scripts/check-secret-leaks-baseline.mjs --min-severity alta # só novos ALTA falham
//   node scripts/check-secret-leaks-baseline.mjs --json              # output JSON
//
// Exit codes:
//   0 — nenhum achado NOVO (ou --update aplicado)
//   1 — achados NOVOS detectados (fail-closed; respeitando --min-severity)
//   2 — infra: audit falhou / baseline ausente (sem --update) / flag inválida
//
// SEVERIDADE (--min-severity): cada achado do audit carrega severity
// (alta/média/baixa — ver audit-secret-leaks.mjs). Por padrão o guard falha
// em QUALQUER achado novo. Com `--min-severity alta`, achados novos de
// severidade MÉDIA/BAIXA são reportados como aviso (não falham) e só os de
// severidade ALTA (chaves privadas, tokens com prefixo) falham — o parecer
// de segurança pede exatamente isto: falhar em QUALQUER achado novo de
// classificação alta, não gatear apenas o total.
// =============================================================================

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/** Path do baseline default (commitado — a fonte da verdade dos achados conhecidos). */
const DEFAULT_BASELINE = "docs/security/secret-leaks-baseline.json"

/**
 * Ordem de severidade (crescente) — usada pelo --min-severity para decidir
 * quais achados NOVOS falham. Fonte: audit-secret-leaks.mjs (alta = chaves
 * privadas + tokens com prefixo; média = atribuições de secret).
 */
export const SEVERITY_ORDER = ["baixa", "média", "alta"]

/**
 * Rank de uma severidade (0=baixa … 2=alta). Severidade desconhecida é
 * tratada como ALTA (rank máximo, fail-closed): um padrão novo no audit sem
 * severity NÃO pode escapar do gate — com --min-severity alta, um achado de
 * severidade desconhecida BLOQUEIA (a opção segura para um guard de segredos
 * é falhar fechado, nunca falhar aberto).
 *
 * @param {string|undefined|null} sev
 * @returns {number}
 */
export function severityRank(sev) {
  const i = SEVERITY_ORDER.indexOf(sev)
  return i === -1 ? SEVERITY_ORDER.length - 1 : i
}

/**
 * Caminho ABSOLUTO do audit-secret-leaks.mjs — resolvido a partir do próprio
 * módulo (não do cwd!): o guard roda com cwd = repo em CI, mas os testes CLI
 * rodam num temp git repo SEM scripts/ — resolver pelo cwd quebraria lá
 * (Cannot find module). O audit recebe o cwd via spawnSync abaixo e roda o
 * `git log -p --all` no repo do caller.
 */
const AUDIT_PATH = join(dirname(fileURLToPath(import.meta.url)), "audit-secret-leaks.mjs")

/**
 * Assinatura estável de um achado — identifica um vazamento específico no
 * histórico. commit+file+line+id+key é determinístico entre runs (o line do
 * hunk é a linha ADICIONADA naquele commit, imutável).
 *
 * ⚠️ ACOPLADO ao id (label PT do audit: 'atribuição de secret', 'token com
 * prefixo', 'chave privada'): renomear um label em audit-secret-leaks.mjs
 * muda TODAS as assinaturas do tipo → o guard semanal acusaria "achados
 * novos" (falso alarme). Aceitável (força re-baseline via --update), mas
 * renomeie labels e rode `--update` na MESMA mudança.
 *
 * @param {{commit: string, file: string, line: number, id: string, key?: string|null}} f
 * @returns {string}
 */
export function signatureOf(f) {
  return `${f.commit}:${f.file}:${f.line}:${f.id}:${f.key ?? ""}`
}

/**
 * Constrói o baseline a partir dos achados atuais (formato do arquivo).
 *
 * @param {Array<{commit: string, file: string, line: number, id: string, key?: string|null, masked: string}>} findings
 * @returns {{count: number, updatedAt: string, findings: object[]}}
 */
export function buildBaseline(findings) {
  return {
    count: findings.length,
    updatedAt: new Date().toISOString().slice(0, 10),
    findings: findings.map((f) => ({
      commit: f.commit,
      file: f.file,
      line: f.line,
      id: f.id,
      severity: f.severity ?? null,
      key: f.key ?? null,
      masked: f.masked,
    })),
  }
}

/**
 * Lê e valida o conteúdo do arquivo de baseline.
 *
 * @param {string} content
 * @returns {{count: number, updatedAt: string, findings: object[]}}
 */
export function parseBaseline(content) {
  const j = JSON.parse(content)
  if (!Array.isArray(j.findings)) {
    throw new Error("baseline sem campo 'findings'")
  }
  return j
}

/**
 * Achados cuja assinatura NÃO existe no baseline — os NOVOS (a regra do guard).
 *
 * @param {Array<object>} current       achados do audit atual
 * @param {Array<object>} baselineFindings  achados do baseline
 * @returns {Array<object>} achados novos (ordenados como no audit)
 */
export function findNewFindings(current, baselineFindings) {
  const known = new Set(baselineFindings.map(signatureOf))
  return current.filter((f) => !known.has(signatureOf(f)))
}

/**
 * Aplica o filtro de severidade: separa os achados novos que DEVEM falhar
 * (severidade >= min) dos que são apenas AVISO (severidade < min). Com
 * min="baixa" (default) todo achado novo falha — comportamento histórico.
 *
 * @param {Array<object>} newFindings  achados novos (do findNewFindings)
 * @param {string} minSeverity  severidade mínima para falhar (baixa/média/alta)
 * @returns {{blocking: Array<object>, warnings: Array<object>}}
 */
export function splitBySeverity(newFindings, minSeverity) {
  const minRank = severityRank(minSeverity)
  const blocking = []
  const warnings = []
  for (const f of newFindings) {
    if (severityRank(f.severity) >= minRank) blocking.push(f)
    else warnings.push(f)
  }
  return { blocking, warnings }
}

function main() {
  const args = process.argv.slice(2)
  const update = args.includes("--update")
  const json = args.includes("--json")

  // --min-severity alta|média|baixa (default: baixa — comportamento histórico)
  const sevIdx = args.indexOf("--min-severity")
  let minSeverity = "baixa"
  if (sevIdx !== -1) {
    if (args[sevIdx + 1] === undefined || !SEVERITY_ORDER.includes(args[sevIdx + 1])) {
      console.error(
        `check-secret-leaks-baseline: --min-severity requer um de ${SEVERITY_ORDER.join("|")}`,
      )
      process.exit(2)
    }
    minSeverity = args[sevIdx + 1]
  }

  const baselineIdx = args.indexOf("--baseline")
  if (baselineIdx !== -1 && args[baselineIdx + 1] === undefined) {
    console.error("check-secret-leaks-baseline: --baseline requer um path")
    process.exit(2)
  }
  const baselinePath = baselineIdx !== -1 ? args[baselineIdx + 1] : DEFAULT_BASELINE

  const cwd = process.cwd()
  const baselineFile = join(cwd, baselinePath)

  // ── Roda o audit real (--json, sem --check → exit 0 mesmo com achados) ──
  // Reutiliza os padrões/masking do audit — UMA fonte de verdade para o que
  // é segredo (sem duplicar regex neste guard). O cwd é passado para o child
  // (o audit roda `git log -p --all` no repo do caller); o PATH do audit é
  // absoluto (AUDIT_PATH), nunca relativo ao cwd.
  const audit = spawnSync(process.execPath, [AUDIT_PATH, "--json"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })

  if (audit.status !== 0 || !audit.stdout) {
    console.error(
      `❌ check-secret-leaks-baseline: audit-secret-leaks falhou (exit ${audit.status ?? "?"}) — não é um repo git?`,
    )
    console.error(audit.stderr ? audit.stderr.slice(0, 800) : "")
    process.exit(2)
  }

  let current
  try {
    current = JSON.parse(audit.stdout)
  } catch {
    console.error("❌ check-secret-leaks-baseline: audit retornou JSON inválido")
    process.exit(2)
  }

  // ── --update: regenera o baseline a partir do audit real ──────────────
  if (update) {
    mkdirSync(dirname(baselineFile), { recursive: true })
    const baseline = buildBaseline(current.findings)
    writeFileSync(baselineFile, `${JSON.stringify(baseline, null, 2)}\n`, "utf8")
    console.log(`✅ Baseline atualizado: ${baseline.count} achado(s) → ${baselinePath}`)
    process.exit(0)
  }

  // ── Fail-closed: baseline ausente sem --update ────────────────────────
  if (!existsSync(baselineFile)) {
    console.error(`❌ Baseline ausente: ${baselinePath}`)
    console.error(`   Rode primeiro: node scripts/check-secret-leaks-baseline.mjs --update`)
    process.exit(2)
  }

  let baseline
  try {
    baseline = parseBaseline(readFileSync(baselineFile, "utf8"))
  } catch (e) {
    console.error(`❌ Baseline inválido (${baselinePath}): ${e.message}`)
    process.exit(2)
  }

  // ── Comparação por assinatura — só achados NOVOS falham ──────────────
  const newFindings = findNewFindings(current.findings, baseline.findings)
  // ── Filtro de severidade: com --min-severity alta, só novos ALTA falham ──
  const { blocking, warnings } = splitBySeverity(newFindings, minSeverity)

  if (json) {
    console.log(
      JSON.stringify(
        {
          count: current.count,
          baselineCount: baseline.count,
          newCount: newFindings.length,
          newFindings,
          minSeverity,
          blockingCount: blocking.length,
          blocking,
        },
        null,
        2,
      ),
    )
    process.exit(blocking.length > 0 ? 1 : 0)
  }

  if (blocking.length === 0 && warnings.length === 0) {
    console.log(
      `🔒 check-secret-leaks-baseline: ${current.count} achado(s) — nenhum NOVO além do baseline (${baseline.count}, ${baseline.updatedAt}).`,
    )
    process.exit(0)
  }

  if (blocking.length === 0 && warnings.length > 0) {
    // Achados novos de severidade ABAIXO do mínimo: aviso (não falha)
    console.error(
      `⚠️  ${warnings.length} achado(s) NOVO(s) de severidade abaixo de '${minSeverity}' ` +
        `(não bloqueiam com --min-severity ${minSeverity}):\n`,
    )
    for (const f of warnings) {
      console.error(
        `   • ${f.commit.slice(0, 12)}  ${f.file}:${f.line}  [${f.id} (${f.severity ?? "?"})]  ${f.masked}` +
          (f.key ? `  (chave: ${f.key})` : ""),
      )
    }
    process.exit(0)
  }

  console.error(
    `🔓 check-secret-leaks-baseline: ${blocking.length} achado(s) NOVO(s) de severidade ` +
      `>= '${minSeverity}' no histórico (baseline ${baseline.count} → atual ${current.count}):\n`,
  )
  for (const f of blocking) {
    console.error(
      `   • ${f.commit.slice(0, 12)}  ${f.file}:${f.line}  [${f.id} (${f.severity ?? "?"})]  ${f.masked}` +
        (f.key ? `  (chave: ${f.key})` : ""),
    )
  }
  if (warnings.length > 0) {
    console.error(
      `\nℹ️  + ${warnings.length} achado(s) novo(s) de severidade menor (não bloqueiam com '${minSeverity}').`,
    )
  }
  console.error(
    `\n⚠️  Segredo NOVO commitado — ROTACIONE o valor (node scripts/rotate-secrets.mjs).` +
      `\n   Após remediar, atualize o baseline: node scripts/check-secret-leaks-baseline.mjs --update`,
  )
  process.exit(1)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
