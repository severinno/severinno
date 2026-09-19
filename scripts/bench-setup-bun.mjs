#!/usr/bin/env node
// =============================================================================
// bench-setup-bun.mjs — bench LOCAL do setup-bun nas 3 configurações
//
// POR QUE EXISTE: a tabela de evidência do README (tempos do setup-bun por
// ambiente) foi medida manualmente em 08/2026. A cada bump do Bun (novo
// BUN_VERSION → re-sync do mirror ubuntu-bun) ou mudança no composite action,
// a medição precisa ser REVALIDADA — e sem este script ela depende de memória
// ou de rodadas manuais ad-hoc. Este script roda o MESMO job (check — o único
// que exercita o setup-bun no pr-check.yml) nas 3 configurações e imprime a
// tabela de tempos automaticamente:
//
//   1. act + imagem DEFAULT (catthehacker/ubuntu:act-latest) — o act EMULA o
//      actions/cache (~21s medidos) e o tier-1 nem engaja (tier-2 emulado).
//   2. act + imagem CUSTOM (ghcr.io/<owner>/ubuntu-bun:<versão>) — tier-1 fast
//      path (bun pré-instalado, ~0.4-0.6s por step).
//   3. CI REAL do GitHub (hosted runner) — NÃO executável localmente; linha
//      DOCUMENTADA (~1-2s warm, tier-2 com cache REAL do GitHub). A medição
//      real via API é o scripts/bench-setup-bun.sh (gh auth + workflow_dispatch).
//
// MÉTRICA: para cada run do act, o log é parseado com os EXTRACTORS
// COMPARTILHADOS dos guards de tier (check-tier1-fastpath.mjs /
// check-tier2-cache-restore.mjs / check-setup-bun-common.mjs) — o composite
// total, o fast-path, o cache restore, cache hit/miss e o tier detectado.
// A evidência do setup-bun aparece nos primeiros ~30s do log do job check
// (steps #2-3); o restante do job (bun install/prisma/tsc/testes) pode falhar
// no act sem invalidar a medição — o guard decide POR EVIDÊNCIA (mesma
// semântica do tier1-fastpath-guard: exit do act é informativo).
//
// Pre-flight: act.exe, daemon docker, .actrc (fonte local do BUN_VERSION) e as
// DUAS imagens locais. Sem elas, o script falha com mensagem clara (exit 1).
//
// Usage:
//   node scripts/bench-setup-bun.mjs                     # 1 run × 2 imagens + CI documentado
//   node scripts/bench-setup-bun.mjs --runs 3            # 3 runs por imagem (cold→warm)
//   node scripts/bench-setup-bun.mjs --timeout 240       # timeout por run do act (s)
//   node scripts/bench-setup-bun.mjs --json out.json     # salva a tabela em JSON
//   node scripts/bench-setup-bun.mjs --custom-tag ghcr.io/x/ubuntu-bun:1.3.14
//   node scripts/bench-setup-bun.mjs -h                  # ajuda
//
// DICA DE TIMEOUT: o job check roda a suite COMPLETA (bun install → prisma
// generate → tsc → testes), então cada run pode levar MINUTOS em máquina
// lenta. A evidência do setup-bun está nos primeiros ~30s (log preservado
// mesmo se o timeout matar o act), mas para um run COMPLETO em hardware
// modesto suba o --timeout (ex.: 600s) — o default 240s é para o caso comum.
//
// Exit codes:
//   0 — bench completo (tabela impressa; evidência do setup-bun encontrada em
//       TODAS as imagens executadas)
//   1 — falha de infra/run (act/docker/.actrc/imagem ausente, ou ALGUMA imagem
//       executada SEM evidência do setup-bun no log)
//   2 — uso incorreto (flag inválida, --runs < 1, --timeout <= 0)
// =============================================================================

import { spawnSync } from "node:child_process"
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { extractFastPathEvidence, extractTierEngagement } from "./check-tier1-fastpath.mjs"
import { requireImageSource } from "./registry-source.mjs"
import { extractCacheRestoreEvidence } from "./check-tier2-cache-restore.mjs"
import { GITHUB_WORKFLOW_DIR } from "./forge-workflows.mjs"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(SCRIPT_DIR, "..")
const ACT = join(REPO_ROOT, "tool-results", "act", "act.exe")
const WORKFLOW_DIR = join(REPO_ROOT, GITHUB_WORKFLOW_DIR)
const JOB = "check" // único job do pr-check.yml que exercita o setup-bun
const ACTRC_PATH = join(REPO_ROOT, ".actrc")

const IMAGE_DEFAULT = "catthehacker/ubuntu:act-latest"

// ---------------------------------------------------------------------------
// Helpers puros (exportados para teste unitário)
// ---------------------------------------------------------------------------

/**
 * Extrai a versão do Bun do .actrc (linha `--var BUN_VERSION=<v>`).
 * Retorna null se a linha não existir. O regex exige a forma SEMVER
 * X.Y.Z (o .actrc pinado é sempre completo, ex.: 1.3.14) — rejeita
 * malformados como '1.3.14..' que o genérico [\d.]+ aceitaria.
 */
export function parseActrcVersion(actrcText) {
  // (?!\d|\.) — negative lookahead: a versão X.Y.Z não pode ser seguida de
  // mais dígito/ponto (rejeita '1.3.14..' que casaria o prefixo '1.3.14').
  const m = String(actrcText).match(/--var\s+BUN_VERSION=(\d+\.\d+\.\d+)(?!\d|\.)/)
  return m ? m[1] : null
}

/**
 * Deriva o owner do GHCR do remote origin (ex.: severinno/severinno →
 * 'severinno'). Fallback: BENCH_OWNER env ou 'severinno'.
 */
export function deriveGhcrOwner(remoteUrl, envOwner = "") {
  if (envOwner) return envOwner
  const m = String(remoteUrl).match(/(?:git@github\.com:|https:\/\/github\.com\/)([^/]+)\//)
  return m ? m[1] : "severinno"
}

/**
 * Classifica o tier do setup-bun a partir do log do act. Ordem de prioridade:
 * download do script (tier-3) > script usou o cache (tier-2) > marcador tier-1
 * (bun pré-instalado) > step de cache rodou (tier-2, sem marcador do script) >
 * sem evidência.
 *
 * O último degrau existe porque, com o setup em `run:`, o actions/cache é um
 * step de PRIMEIRO NÍVEL que roda SEMPRE — a linha dele não prova qual camada
 * o SCRIPT usou, mas quando não há marcador tier-1 nem sinal do script, o
 * cache é a única camada observável (ex.: cache emulado pelo act).
 *
 * @param {import("./check-tier1-fastpath.mjs").FastPathEvidence} fast
 * @param {import("./check-tier2-cache-restore.mjs").CacheRestoreEvidence} cache
 * @param {{ tier2Engaged: boolean, tier3Engaged: boolean }} tiers
 * @returns {"tier-1" | "tier-2" | "tier-3" | "sem evidência"}
 */
export function classifyTier(fast, cache, tiers) {
  if (tiers.tier3Engaged) return "tier-3"
  if (tiers.tier2Engaged) return "tier-2"
  if (fast.markerVersion !== null) return "tier-1"
  if (cache.cacheRestoreEngaged) return "tier-2"
  return "sem evidência"
}

/**
 * Parseia UM log do act e devolve a linha da tabela de bench:
 *   { ambiente, imagem, tier, compositeSeconds, fastPathSeconds,
 *     restoreSeconds, cacheHit, cacheMiss, markerVersion, hasEvidence }
 * Usa os extractors COMPARTILHADOS dos guards de tier (fonte única — sem
 * duplicar parse de log entre os guards e o bench).
 */
export function parseBenchRow({ ambiente, imagem, logText }) {
  const fast = extractFastPathEvidence(logText)
  const cache = extractCacheRestoreEvidence(logText)
  const tiers = extractTierEngagement(logText)
  const tier = classifyTier(fast, cache, tiers)
  const compositeSeconds =
    fast.compositeDurationSeconds !== null
      ? fast.compositeDurationSeconds
      : cache.compositeDurationSeconds
  return {
    ambiente,
    imagem,
    tier,
    compositeSeconds,
    fastPathSeconds: fast.fastPathDurationSeconds,
    restoreSeconds: cache.cacheRestoreDurationSeconds,
    cacheHit: cache.cacheHit,
    cacheMiss: cache.cacheMiss,
    markerVersion: fast.markerVersion,
    hasEvidence:
      fast.markerVersion !== null ||
      fast.fastPathDurationSeconds !== null ||
      fast.compositeDurationSeconds !== null ||
      cache.cacheRestoreDurationSeconds !== null ||
      // Mesmo contrato do setupBunEvidence do tier-1 guard: engajamento
      // EXPLÍCITO de tier-2/tier-3 também conta como evidência (ex.: download
      // cold-cache com restore skipped → sem linha de duração no bench, mas o
      // setup-bun RODOU — o log tem 'Success - Main Download Bun release').
      tiers.tier2Engaged ||
      tiers.tier3Engaged,
  }
}

/**
 * Linha DOCUMENTADA do CI real (não executável localmente — GitHub-hosted).
 * Os tempos são a expectativa da tabela do README (08/2026); a medição REAL
 * via jobs API é o scripts/bench-setup-bun.sh (gh auth + workflow_dispatch).
 */
export function documentedCiRow(bunVersion) {
  return {
    ambiente: "CI real do GitHub (hosted runner)",
    imagem: "ubuntu-latest (GitHub-hosted)",
    tier: "tier-2 (cache REAL do GitHub)",
    compositeSeconds: null,
    fastPathSeconds: null,
    restoreSeconds: null,
    cacheHit: false,
    cacheMiss: false,
    markerVersion: null,
    hasEvidence: false,
    documented: `~1-2s warm esperado (tier-2 real; bun ${bunVersion}) — medir com scripts/bench-setup-bun.sh`,
  }
}

const fmt = (v) => (v === null || v === undefined ? "-" : `${v.toFixed(3)}s`)

/**
 * Formata a tabela de bench (markdown-ish, alinhada) a partir das linhas.
 * @param {Array<object>} rows
 * @returns {string}
 */
export function formatBenchTable(rows) {
  const header = [
    "| Ambiente | Tier | composite | fast-path | restore | cache |",
    "| :------- | :--- | :-------- | :-------- | :------ | :---- |",
  ]
  const body = rows.map((r) => {
    const cache = r.cacheHit ? "HIT" : r.cacheMiss ? "MISS" : "-"
    const cols = [
      r.ambiente,
      r.tier,
      r.documented ? r.documented : fmt(r.compositeSeconds),
      fmt(r.fastPathSeconds),
      fmt(r.restoreSeconds),
      cache,
    ]
    return `| ${cols.join(" | ")} |`
  })
  return [...header, ...body].join("\n")
}

// ---------------------------------------------------------------------------
// Infra (não puro — executa act/docker)
// ---------------------------------------------------------------------------

function preflight() {
  const problems = []
  if (!existsSync(ACT)) problems.push(`act.exe não encontrado em ${ACT}`)
  if (!existsSync(ACTRC_PATH)) problems.push(`.actrc ausente na raiz — o act local quebraria`)
  const docker = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
  })
  if (docker.status !== 0 || !docker.stdout.trim())
    problems.push("daemon docker não responde (Docker Desktop rodando?)")
  return problems
}

function imageExists(imageTag) {
  const r = spawnSync("docker", ["image", "inspect", imageTag], { stdio: "ignore" })
  return r.status === 0
}

/**
 * Roda o act uma vez e devolve { logPath, actExit, wallMs }.
 * O log é escrito DIRETO num fd (stdio) — se o timeout matar o act no meio,
 * o arquivo preserva tudo o que já foi escrito (a evidência do setup-bun está
 * nos primeiros ~30s). wallMs = tempo de parede da execução (ms).
 */
function runActOnce({ timeoutS, imageTag }) {
  const logPath = join(REPO_ROOT, `tool-results/bench-setup-bun-${Date.now()}.log`)
  const logFd = openSync(logPath, "w")
  const started = Date.now()
  const args = [
    "-b",
    "-W",
    WORKFLOW_DIR,
    "-j",
    JOB,
    "-P",
    `ubuntu-latest=${imageTag}`,
    "--pull=false",
    "--secret",
    "GITHUB_TOKEN=bench-local",
  ]
  // --pull=false + -P são os mesmos do act-startup-bench.sh; a imagem vem do
  // caller (default catthehacker vs custom ubuntu-bun) — nunca hardcode.
  const res = spawnSync(ACT, args, {
    cwd: REPO_ROOT,
    timeout: timeoutS * 1000,
    stdio: ["ignore", logFd, logFd],
  })
  closeSync(logFd)
  const wallMs = Date.now() - started
  return { logPath, actExit: res.status === null ? -1 : res.status, wallMs }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Uso:
  node scripts/bench-setup-bun.mjs [opções]

  --runs N          execuções do act por imagem (default: 1; run 2+ = warm)
  --timeout S       timeout por run do act em segundos (default: 240)
  --json FILE       salva as linhas da tabela em JSON
  --custom-tag T    override da imagem custom ubuntu-bun (ex.: ghcr.io/<owner>/ubuntu-bun:<X.Y.Z>)
                    — a tag real vem da variável BUN_VERSION; o exemplo não tem
                    versão de propósito (um exemplo com versão envelhece sozinho)
  -h, --help        mostra esta ajuda

Exit codes: 0 = PASS (tabela impressa, evidência em todas as imagens),
            1 = falha de infra/run, 2 = uso inválido`

export function parseArgs(argv) {
  const out = { runs: 1, timeout: 240, json: null, customTag: null, help: false, error: null }
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--runs": {
        const v = argv[++i]
        if (v === undefined || !/^\d+$/.test(v) || Number(v) < 1)
          return { ...out, error: `--runs deve ser inteiro >= 1 (obtido: '${v}')` }
        out.runs = Number(v)
        break
      }
      case "--timeout": {
        const v = argv[++i]
        if (v === undefined || !/^\d+$/.test(v) || Number(v) <= 0)
          return { ...out, error: `--timeout deve ser inteiro > 0 (obtido: '${v}')` }
        out.timeout = Number(v)
        break
      }
      case "--json": {
        const v = argv[++i]
        if (v === undefined) return { ...out, error: `--json exige um valor` }
        out.json = v
        break
      }
      case "--custom-tag": {
        const v = argv[++i]
        if (v === undefined) return { ...out, error: `--custom-tag exige um valor` }
        out.customTag = v
        break
      }
      case "-h":
      case "--help":
        return { ...out, help: true }
      default:
        return { ...out, error: `argumento desconhecido: ${argv[i]}` }
    }
  }
  return out
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    process.exit(0)
  }
  if (args.error) {
    console.error(`❌ ${args.error}\n\n${USAGE}`)
    process.exit(2)
  }

  // ── Pre-flight ────────────────────────────────────────────────────────────
  const problems = preflight()
  if (problems.length > 0) {
    for (const p of problems) console.error(`❌ ${p}`)
    process.exit(1)
  }
  const actrc = readFileSync(ACTRC_PATH, "utf8")
  const bunVersion = parseActrcVersion(actrc)
  if (!bunVersion) {
    console.error(`❌ .actrc não define BUN_VERSION — adicione '--var BUN_VERSION=<versão>'`)
    process.exit(1)
  }
  const remoteUrl = spawnSync("git", ["config", "--get", "remote.origin.url"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).stdout.trim()
  const owner = deriveGhcrOwner(remoteUrl, process.env.BENCH_OWNER || "")
  // Registry da imagem custom — FONTE ÚNICA (env IMAGE_REGISTRY, mesmo
  // contrato dos workflows e do .env.production). O valor vem do RESOLVEDOR
  // (`registry-source.mjs`): env e, na falta dele, o espelho DECLARADO — nunca
  // um literal de reserva, que sobreviveria à troca de registry em silêncio.
  let registry
  try {
    registry = requireImageSource({ root: REPO_ROOT }).registry
  } catch (e) {
    console.error(`❌ bench-setup-bun: ${e.message}`)
    process.exit(2)
  }
  const customTag = args.customTag || `${registry}/${owner}/ubuntu-bun:${bunVersion}`
  const imageTags = [
    { id: "default", tag: IMAGE_DEFAULT, label: `act + ${IMAGE_DEFAULT}` },
    { id: "custom", tag: customTag, label: `act + ${customTag}` },
  ]
  for (const { tag } of imageTags) {
    if (!imageExists(tag)) {
      console.error(`❌ imagem ausente: ${tag} — rode 'docker pull ${tag}' primeiro`)
      process.exit(1)
    }
  }

  // ── Banner ────────────────────────────────────────────────────────────────
  console.log("")
  console.log("  ═══════════════════════════════════════════════════════════════")
  console.log(
    `   🚀 BENCH SETUP-BUN (job ${JOB} × ${args.runs} run(s) por imagem, bun ${bunVersion})`,
  )
  console.log("  ═══════════════════════════════════════════════════════════════")
  console.log("")

  // ── Execução: act -j check por imagem × runs ──────────────────────────────
  const rows = []
  let anyMissingEvidence = false
  for (const { id, tag, label } of imageTags) {
    for (let run = 1; run <= args.runs; run++) {
      const { logPath, actExit, wallMs } = runActOnce({ timeoutS: args.timeout, imageTag: tag })
      const logText = readFileSync(logPath, "utf8")
      const row = parseBenchRow({ ambiente: label, imagem: tag, logText })
      row.run = run
      row.actExit = actExit
      row.wallMs = wallMs
      rows.push(row)
      if (!row.hasEvidence) anyMissingEvidence = true
      console.log(
        `  ▶ [${id}] run ${run}/${args.runs}: tier=${row.tier} composite=${fmt(row.compositeSeconds)} fast-path=${fmt(row.fastPathSeconds)} restore=${fmt(row.restoreSeconds)} (act exit ${actExit}, ${wallMs}ms)`,
      )
    }
  }

  // ── Linha documentada do CI real ──────────────────────────────────────────
  rows.push(documentedCiRow(bunVersion))

  // ── Tabela ────────────────────────────────────────────────────────────────
  console.log("")
  console.log("  Tabela comparativa — setup-bun (re-medição local vs CI documentado):")
  console.log(formatBenchTable(rows))
  console.log("")
  console.log("  Nota: a evidência do setup-bun está nos primeiros ~30s do log;")
  console.log("  o restante do job check pode falhar no act sem invalidar a medição.")
  console.log("  CI real (linha 3): medir com scripts/bench-setup-bun.sh (gh auth).")

  if (args.json) {
    writeFileSync(
      args.json,
      JSON.stringify({ bunVersion, measured: new Date().toISOString(), rows }, null, 2),
    )
    console.log(`  JSON salvo em ${args.json}`)
  }

  process.exit(anyMissingEvidence ? 1 : 0)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
