#!/usr/bin/env node
// =============================================================================
// check-bun-audit-baseline.mjs — Guard de DRIFT de vulnerabilidades de deps
// =============================================================================
//
// Usage:
//   node scripts/check-bun-audit-baseline.mjs                     # check real
//   node scripts/check-bun-audit-baseline.mjs --update            # regenera baseline
//   node scripts/check-bun-audit-baseline.mjs --min-severity high # só novos high+ falham
//   node scripts/check-bun-audit-baseline.mjs --baseline X        # path custom
//   node scripts/check-bun-audit-baseline.mjs --results-file X.json # fixture (testes/
//                                                                  # mutation tests — NÃO
//                                                                  # roda o bun audit)
//   node scripts/check-bun-audit-baseline.mjs --json              # output JSON
//
// Exit codes:
//   0 — nenhum achado NOVO bloqueante (ou --update aplicado)
//   1 — achados NOVOS de severidade >= min detectados (fail-closed)
//   2 — infra: bun audit falhou / results inválido / baseline ausente
//       (sem --update) / flag inválida
//
// Roda o `bun audit --json` REAL (escaneia bun.lock contra o banco de
// advisories) e compara os achados com um BASELINE commitado
// (docs/security/bun-audit-baseline.json). Falha (exit 1) SOMENTE se
// achados NOVOS de severidade >= `--min-severity` (default: high = high +
// critical) aparecerem — o baseline documenta as vulnerabilidades JÁ
// conhecidas das deps (83 em 08/2026: 1 critical, 41 high, 35 moderate,
// 6 low). Uma dep VULNERÁVEL NOVA (ou bump que traga advisory novo) vira
// falha no job, alertando antes do incidente.
//
// Por que baseline e não zero: as deps atuais JÁ têm 83 advisories — zerar
// é remediação deliberada (bump de deps/overrides), não CI. O guard protege
// o FUTURO. O count do baseline é DERIVADO do audit real (nunca literal) —
// `--update` regenera o arquivo (mesmo princípio do check-secret-leaks-baseline).
//
// Comparação por ASSINATURA (pacote:url-do-advisory), não por count: um
// advisory removido e outro adicionado mantém o count, mas a assinatura
// NOVA é detectada. Achados REMOVIDOS (bump de dep) NÃO falham — só novos.
// ESCALAÇÃO de severidade também falha: um advisory CONHECIDO que sobe de
// severidade no banco (ex.: moderate → high) cruza o limiar de exposição e
// é reportado como bloqueio (o espelho do 'crescimento' do findDrift da
// suíte jsdom). Fail-closed: baseline ausente sem --update = exit 2 com
// instrução clara.
//
// ⚠️ OPERACIONAL: o bun audit reflete o banco de advisories EXTERNO (GitHub
// Advisory DB), não só o lockfile — um advisory NOVO (ou escalado) pode
// aparecer SEM nenhuma mudança de dep no repo. O fluxo de triagem é: avaliar
// a exposição e, após remediar/triar, `node scripts/check-bun-audit-baseline.mjs --update`
// (nunca re-baselineie para esconder um advisory real).
//
// SEVERIDADE (--min-severity): valores em INGLÊS (as severidades do bun
// audit/GitHub Advisory são EN — low/moderate/high/critical; 'info' entra na
// ordem para o futuro). O default é `high` (high/critical bloqueiam) — o
// pedido do parecer de segurança ("falhar em QUALQUER achado novo de
// classificação alta, não gatear só o total"). Achados novos de severidade
// MENOR viram aviso (não falham). Severidade desconhecida é tratada como
// CRITICAL (fail-closed): um advisory novo sem severity NÃO pode escapar do
// gate.
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

// O GERADO passa pelo formatador do repositório: a baseline é um arquivo
// VERSIONADO, e o `JSON.stringify(…, 2)` sozinho a deixa fora do lint (o prettier
// colapsa o que cabe na largura).
import { escreverJsonFormatado } from "./prettier-format.mjs"
import { pathToFileURL } from "node:url"

/** Path do baseline default (commitado — a fonte da verdade dos advisories conhecidos). */
const DEFAULT_BASELINE = "docs/security/bun-audit-baseline.json"

const BUN_AUDIT_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Ordem de severidade (crescente) — usada pelo --min-severity para decidir
 * quais achados NOVOS falham. O bun audit emite low/moderate/high/critical
 * (08/2026); 'info' entra na ordem para o futuro (GitHub Advisory severity
 * levels completos).
 */
export const SEVERITY_ORDER = ["info", "low", "moderate", "high", "critical"]

/**
 * Rank de uma severidade (0=info … 4=critical). Severidade desconhecida é
 * tratada como CRITICAL (rank máximo, fail-closed): um advisory novo com
 * severity fora do conjunto conhecido NÃO pode escapar do gate.
 *
 * @param {string|undefined|null} sev
 * @returns {number}
 */
export function severityRank(sev) {
  const i = SEVERITY_ORDER.indexOf(sev)
  return i === -1 ? SEVERITY_ORDER.length - 1 : i
}

/**
 * Parse do JSON do `bun audit --json` (shape: `{ [packageName]: [advisory] }`
 * onde cada advisory tem id, url (GHSA), title, severity, vulnerable_versions)
 * → achados normalizados. Um advisory do MESMO pacote pode vir duplicado
 * entre versões — dedupe por assinatura (pacote:url) preservando o maior
 * severity (a pior versão manda).
 *
 * @param {string|object} json
 * @returns {Array<{package: string, url: string, severity: string, title: string}>}
 */
export function parseAuditJson(json) {
  const j = typeof json === "string" ? JSON.parse(json) : json
  if (!j || typeof j !== "object") throw new Error("audit sem objeto de pacotes")
  const bySig = new Map()
  for (const [pkg, advisories] of Object.entries(j)) {
    if (!Array.isArray(advisories)) continue
    for (const a of advisories) {
      if (!a || !a.url) continue
      const sig = `${pkg}:${a.url}`
      const prev = bySig.get(sig)
      if (!prev || severityRank(a.severity) > severityRank(prev.severity)) {
        bySig.set(sig, {
          package: pkg,
          url: a.url,
          severity: a.severity ?? "unknown",
          title: a.title ?? a.url,
        })
      }
    }
  }
  return [...bySig.values()]
}

/**
 * Assinatura estável de um achado — identifica um advisory específico
 * afetando um pacote específico. pacote:url (GHSA) é determinístico entre
 * runs e estável entre versões do bun. O MESMO GHSA pode afetar VÁRIOS
 * pacotes (ex.: uma advisory de lodash afeta lodash e lodash-es) — o pacote
 * na assinatura distingue os dois.
 *
 * @param {{package: string, url: string}} f
 * @returns {string}
 */
export function signatureOf(f) {
  return `${f.package}:${f.url}`
}

/**
 * Constrói o baseline a partir dos achados atuais (formato do arquivo).
 *
 * @param {Array<{package: string, url: string, severity: string, title: string}>} findings
 * @returns {{count: number, updatedAt: string, findings: object[]}}
 */
export function buildBaseline(findings) {
  return {
    count: findings.length,
    updatedAt: new Date().toISOString().slice(0, 10),
    findings: findings.map((f) => ({
      package: f.package,
      url: f.url,
      severity: f.severity,
      title: f.title,
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
 * Escalações de severidade: achados cuja ASSINATURA (pacote:url) já existe
 * no baseline mas cuja severidade ATUAL é MAIOR que a do baseline (ex.: o
 * advisory DB reclassificou moderate → high). A comparação por assinatura
 * sozinha (findNewFindings) NÃO vê isso — a assinatura é a mesma; só o
 * severity mudou. É o espelho do 'crescimento' do findDrift da suíte jsdom:
 * um advisory conhecido que SOBE de severidade cruza o limiar de exposição
 * e precisa de atenção, não só os advisories novos.
 *
 * @param {Array<object>} current  achados do audit atual
 * @param {Array<object>} baselineFindings  achados do baseline
 * @returns {Array<{finding: object, baselineSeverity: string}>}
 */
export function findSeverityEscalations(current, baselineFindings) {
  const baseline = new Map(baselineFindings.map((f) => [signatureOf(f), f]))
  const escalations = []
  for (const f of current) {
    const b = baseline.get(signatureOf(f))
    if (b && severityRank(f.severity) > severityRank(b.severity)) {
      escalations.push({ finding: f, baselineSeverity: b.severity })
    }
  }
  return escalations
}

/**
 * Aplica o filtro de severidade: separa os achados novos que DEVEM falhar
 * (severidade >= min) dos que são apenas AVISO (severidade < min). Com
 * min="high" (default) só novos high/critical falham; com min="low" todo
 * achado novo falha.
 *
 * @param {Array<object>} newFindings  achados novos (do findNewFindings)
 * @param {string} minSeverity  severidade mínima para falhar
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

/**
 * Coleta os achados a partir do audit REAL do bun OU de um fixture
 * (--results-file). Fail-closed (exit 2) quando o bun audit falha ou o
 * fixture não existe.
 *
 * @param {string} cwd          diretório de trabalho (cwd do bun audit)
 * @param {string|null} resultsFile  path do fixture (null = run real)
 * @returns {Array<object>} achados normalizados (do parseAuditJson)
 */
function collectFindings(cwd, resultsFile) {
  let raw
  if (resultsFile) {
    if (!existsSync(join(cwd, resultsFile))) {
      console.error(`❌ --results-file não encontrado: ${resultsFile}`)
      process.exit(2)
    }
    try {
      raw = readFileSync(join(cwd, resultsFile), "utf8")
    } catch (e) {
      console.error(`❌ Não foi possível ler --results-file: ${e.message}`)
      process.exit(2)
    }
  } else {
    // stdout do `bun audit --json` É o JSON (stderr tem o banner). Windows:
    // bun é bun.exe — shell:true resolve via cmd.exe; no Linux via /bin/sh.
    const res = spawnSync("bun audit --json", {
      cwd,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      timeout: BUN_AUDIT_TIMEOUT_MS,
      shell: true,
    })
    // Exit cru do bun audit é 1 quando há vulnerabilidades — ESPERE isso
    // (o guard compara contra o baseline; o exit não decide nada). O gate é
    // o stdout parseável como JSON.
    try {
      JSON.parse(res.stdout ?? "")
      raw = res.stdout
    } catch {
      console.error(
        `❌ check-bun-audit-baseline: bun audit não produziu JSON válido` +
          ` (exit ${res.status ?? "?"}) — infra, não drift.` +
          ` (bun instalado? rode 'bun install' primeiro)`,
      )
      if (res.error?.message) console.error(res.error.message)
      console.error(res.stderr ? res.stderr.slice(0, 800) : "")
      process.exit(2)
    }
  }

  try {
    return parseAuditJson(raw)
  } catch (e) {
    console.error(`❌ check-bun-audit-baseline: JSON de audit inválido: ${e.message}`)
    process.exit(2)
  }
}

function main() {
  const args = process.argv.slice(2)
  const update = args.includes("--update")
  const json = args.includes("--json")

  // --min-severity info|low|moderate|high|critical (default: high)
  const sevIdx = args.indexOf("--min-severity")
  let minSeverity = "high"
  if (sevIdx !== -1) {
    if (args[sevIdx + 1] === undefined || !SEVERITY_ORDER.includes(args[sevIdx + 1])) {
      console.error(
        `check-bun-audit-baseline: --min-severity requer um de ${SEVERITY_ORDER.join("|")}`,
      )
      process.exit(2)
    }
    minSeverity = args[sevIdx + 1]
  }

  const baselineIdx = args.indexOf("--baseline")
  if (baselineIdx !== -1 && args[baselineIdx + 1] === undefined) {
    console.error("check-bun-audit-baseline: --baseline requer um path")
    process.exit(2)
  }
  const baselinePath = baselineIdx !== -1 ? args[baselineIdx + 1] : DEFAULT_BASELINE

  const resultsIdx = args.indexOf("--results-file")
  if (resultsIdx !== -1 && args[resultsIdx + 1] === undefined) {
    console.error("check-bun-audit-baseline: --results-file requer um path")
    process.exit(2)
  }
  const resultsFile = resultsIdx !== -1 ? args[resultsIdx + 1] : null

  const cwd = process.cwd()
  const baselineFile = join(cwd, baselinePath)

  const current = collectFindings(cwd, resultsFile)

  // ── --update: regenera o baseline a partir do audit atual ──────────────
  if (update) {
    mkdirSync(dirname(baselineFile), { recursive: true })
    const baseline = buildBaseline(current)
    escreverJsonFormatado(baselineFile, baseline)
    console.log(`✅ Baseline atualizado: ${current.length} achado(s) → ${baselinePath}`)
    process.exit(0)
  }

  // ── Fail-closed: baseline ausente sem --update ────────────────────────
  if (!existsSync(baselineFile)) {
    console.error(`❌ Baseline ausente: ${baselinePath}`)
    console.error(`   Rode primeiro: node scripts/check-bun-audit-baseline.mjs --update`)
    process.exit(2)
  }

  let baseline
  try {
    baseline = parseBaseline(readFileSync(baselineFile, "utf8"))
  } catch (e) {
    console.error(`❌ Baseline inválido (${baselinePath}): ${e.message}`)
    process.exit(2)
  }

  // ── Comparação por assinatura — achados NOVOS + ESCALAÇÕES de severidade
  // de advisories conhecidos (o espelho do 'crescimento' do findDrift). ──
  const newFindings = findNewFindings(current, baseline.findings)
  const escalations = findSeverityEscalations(current, baseline.findings)
  const { blocking, warnings } = splitBySeverity(newFindings, minSeverity)
  const escBlocking = escalations.filter(
    (e) => severityRank(e.finding.severity) >= severityRank(minSeverity),
  )
  const escWarnings = escalations.filter(
    (e) => severityRank(e.finding.severity) < severityRank(minSeverity),
  )
  const totalBlocking = blocking.length + escBlocking.length
  const totalWarnings = warnings.length + escWarnings.length

  if (json) {
    console.log(
      JSON.stringify(
        {
          count: current.length,
          baselineCount: baseline.count,
          newCount: newFindings.length,
          escalationCount: escalations.length,
          minSeverity,
          blockingCount: totalBlocking,
          blocking,
          escalations: escBlocking.map((e) => ({
            package: e.finding.package,
            url: e.finding.url,
            severity: e.finding.severity,
            baselineSeverity: e.baselineSeverity,
          })),
          escalationWarnings: escWarnings.map((e) => ({
            package: e.finding.package,
            url: e.finding.url,
            severity: e.finding.severity,
            baselineSeverity: e.baselineSeverity,
          })),
          warnings,
        },
        null,
        2,
      ),
    )
    process.exit(totalBlocking > 0 ? 1 : 0)
  }

  if (totalBlocking === 0 && totalWarnings === 0) {
    console.log(
      `🔒 check-bun-audit-baseline: ${current.length} achado(s) — nenhum NOVO nem` +
        ` escala de severidade além do baseline (${baseline.count}, ${baseline.updatedAt}).`,
    )
    process.exit(0)
  }

  if (totalBlocking === 0 && totalWarnings > 0) {
    console.error(
      `⚠️  ${totalWarnings} achado(s) de severidade abaixo de '${minSeverity}'` +
        ` (não bloqueiam com --min-severity ${minSeverity}):\n`,
    )
    for (const f of warnings) {
      console.error(`   • ${f.package}  [${f.severity}]  ${f.url}`)
    }
    for (const e of escWarnings) {
      console.error(
        `   • ${e.finding.package}  [${e.baselineSeverity} → ${e.finding.severity}]  ${e.finding.url}`,
      )
    }
    process.exit(0)
  }

  console.error(
    `🔓 check-bun-audit-baseline: ${totalBlocking} achado(s) NOVO(s) de severidade` +
      ` >= '${minSeverity}' nas deps (baseline ${baseline.count} → atual ${current.length}):\n`,
  )
  for (const f of blocking) {
    console.error(`   • ${f.package}  [${f.severity}]  ${f.url}`)
    console.error(`     ${f.title}`)
  }
  for (const e of escBlocking) {
    console.error(
      `   • ESCALAÇÃO de severidade: ${e.finding.package}  [${e.baselineSeverity} → ${e.finding.severity}]  ${e.finding.url}`,
    )
    console.error(`     ${e.finding.title}`)
  }
  if (totalWarnings > 0) {
    console.error(
      `\nℹ️  + ${totalWarnings} achado(s) de severidade menor (não bloqueiam com '${minSeverity}').`,
    )
  }
  console.error(
    `\n⚠️  Vulnerabilidade NOVA (ou escalada) nas deps — atualize a dep afetada` +
      `\n   (bun update <pkg>) ou avalie a exposição. ATENÇÃO: o bun audit reflete` +
      `\n   o banco de advisories EXTERNO, não só o lockfile — um advisory novo` +
      `\n   pode aparecer sem NENHUMA mudança de dep no repo. Após triar,` +
      `\n   atualize o baseline: node scripts/check-bun-audit-baseline.mjs --update`,
  )
  process.exit(1)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
