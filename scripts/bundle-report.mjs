#!/usr/bin/env node
/**
 * Versioned bundle report generator — Severinno
 *
 * Runs `scripts/check-js-budget.mjs --json` (requires a fresh
 * `ANALYZE=true next build --webpack` so .next/analyze/client.html +
 * .next/server/app/index.html exist), then upserts a row for the current
 * version into `docs/bundle-report.md`, tracking the evolution of
 * initial/total/per-library sizes AND the per-route real transfer (check 7)
 * across releases with deltas vs the previous version.
 *
 * Usage:
 *   node scripts/bundle-report.mjs --version v0.4.0   # explicit version
 *   node scripts/bundle-report.mjs                    # git tag → package.json
 *   node scripts/bundle-report.mjs --version main     # rolling "main" row — upserted on
 *                                                     # EVERY push to main (ci.yml budget
 *                                                     # job), sorted ABOVE the versioned
 *                                                     # releases so Δ compares against the
 *                                                     # last release. Never accumulates
 *                                                     # duplicate rows (same label = upsert).
 *                                                     # ANTI-REGRESSION GATE: fails (exit 1)
 *                                                     # if the merged bundle's Initial JS (/),
 *                                                     # Total, or any key ROUTE's real transfer
 *                                                     # worsened by more than the threshold vs the
 *                                                     # last versioned release, so a per-merge
 *                                                     # regression BLOCKS the push to main
 *                                                     # (thresholds in KB gzip, env-overridable,
 *                                                     # defaults 50/200/30-per-route):
 *                                                     #   JS_BUDGET_MAIN_DELTA_INITIAL_KB
 *                                                     #   JS_BUDGET_MAIN_DELTA_TOTAL_KB
 *                                                     #   JS_BUDGET_MAIN_DELTA_ROUTE_BUSCA_KB
 *                                                     #   JS_BUDGET_MAIN_DELTA_ROUTE_DASHBOARD_KB
 *                                                     #   JS_BUDGET_MAIN_DELTA_ROUTE_U_KB
 *                                                     #   JS_BUDGET_MAIN_DELTA_ROUTE_CATEGORIA_KB
 *                                                     # (per-route = check-7 real transfer; a route
 *                                                     # worsening 30 KB without touching / initial
 *                                                     # would otherwise escape the gate)
 *   node scripts/bundle-report.mjs --version develop  # rolling "develop" row — same upsert
 *                                                     # mechanism for push to develop (ci.yml),
 *                                                     # sorted BELOW main but ABOVE releases so
 *                                                     # feature-merge evolution is tracked in the
 *                                                     # report before reaching main. TRACKING
 *                                                     # ONLY: the anti-regression gate stays
 *                                                     # main-only by design (develop is WIP —
 *                                                     # merges there must not be blocked).
 *   node scripts/bundle-report.mjs --preview          # PR comment body: delta vs the
 *                                                     # last versioned release, printed
 *                                                     # to stdout, WITHOUT touching
 *                                                     # docs/bundle-report.md (read-only)
 *
 * CI wiring: run after `bun run budget:js` in the release `budget` job; commit
 * the generated docs/bundle-report.md on tag pushes (see release-deploy.yml).
 * `--preview` is used by ci.yml on PRs (bundle-preview-comment.yml posts it).
 *
 * Also writes docs/bundle-badge.json (Shields.io endpoint badge: initial KB +
 * gate status of the latest release) — consumed by the README cover badge.
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const CHECK = path.join(ROOT, "scripts", "check-js-budget.mjs")
const REPORT = path.join(ROOT, "docs", "bundle-report.md")

function fail(msg, code = 1) {
  console.error("❌ bundle-report: " + msg)
  process.exit(code)
}

// ── Version resolution: --version > git tag > package.json ──────────────────
const args = process.argv.slice(2)
const vi = args.indexOf("--version")
const preview = args.includes("--preview")
let version = vi !== -1 && args[vi + 1] ? args[vi + 1] : null
if (!version) {
  const tag = spawnSync("git", ["describe", "--tags", "--abbrev=0"], { encoding: "utf8" })
  if (tag.status === 0 && tag.stdout.trim()) version = tag.stdout.trim()
}
if (!version) {
  version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version
}

// ── Collect metrics from check-js-budget --json ─────────────────────────────
const res = spawnSync(process.execPath, [CHECK, "--json"], { encoding: "utf8" })
if (res.status === 2 || !res.stdout) {
  fail(
    "check-js-budget --json failed (run ANALYZE=true next build --webpack first):\n" +
      (res.stderr || "").trim(),
    2,
  )
}
let m
try {
  m = JSON.parse(res.stdout)
} catch {
  fail("invalid --json output from check-js-budget:\n" + res.stdout.slice(0, 500), 2)
}

const today = new Date().toISOString().slice(0, 10)
const num = (v) => (v == null ? null : +v.toFixed(1))
const cell = (v) => (v == null ? "—" : v.toFixed(1))

/** Env override helper: positive finite number or fallback (KB, gzip). */
const numEnv = (raw, fallback) => {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const entry = {
  version,
  date: today,
  initialKB: num(m.initialKB),
  totalKB: num(m.totalKB),
  largestKB: num(m.largestKB),
  maplibreKB: num(m.libs?.["maplibre-gl"]?.gzipKB),
  rechartsKB: num(m.libs?.recharts?.gzipKB),
  framerKB: num(m.libs?.["framer-motion"]?.gzipKB),
  topChunks: Array.isArray(m.topChunks) ? m.topChunks : [],
  // Real transfer per key route (check 7) — user-facing first-paint bytes per
  // page, parsed from the prerendered HTML script lists (worst case over
  // params). Same labels as the gate's REAL_ROUTE_CHECKS.
  routes: m.realRoutes
    ? Object.entries(m.realRoutes)
        .filter(([, v]) => v && typeof v.gzipKB === "number")
        .map(([label, v]) => ({ label, gzipKB: num(v.gzipKB), files: v.files || 1 }))
    : [],
  ok: !!m.ok,
}

// ── Read existing history (docs/bundle-report.md table) ─────────────────────
// Columns: Versão | Data | Initial (/) | Δ Init | Total | Δ Total | Largest |
//          Δ Largest | Maplibre | Recharts | Framer | Δ Framer | Gate
const HEADER = [
  "Versão",
  "Data",
  "Initial (/)",
  "Δ Init",
  "Total",
  "Δ Total",
  "Largest",
  "Δ Largest",
  "Maplibre",
  "Recharts",
  "Framer",
  "Δ Framer",
  "Gate",
]

/** Parse the per-version "Top 5 maiores chunks" blocks from the existing md. */
function parseTopChunks(md) {
  const map = {}
  // Split on /\r?\n (not "\n"): .gitattributes `* text=auto` checks the
  // committed docs out as CRLF on Windows, and a trailing \r silently
  // broke every $-anchored regex below — baseline blocks parsed as empty
  // (gate skipped with "sem baseline por rota ainda") AND were dropped on
  // the next regeneration (data loss). Tolerating both is the durable fix.
  const lines = md.split(/\r?\n/)
  let cur = null
  for (const line of lines) {
    const h = line.match(/^###\s+(v?[\w][\w.-]*)\s+—\s+(\d{4}-\d{2}-\d{2})$/)
    if (h) {
      cur = h[1]
      map[cur] = []
      continue
    }
    if (!cur) continue
    const row = line.match(/^\|\s*(\d+)\s*\|\s*([^|]+)\s*\|\s*([\d.]+)\s*\|$/)
    if (row) map[cur].push({ label: row[2].trim(), gzipKB: Number(row[3]) })
    else if (line.startsWith("## ")) cur = null
  }
  return map
}

/** Parse the per-version "Rotas (real transfer)" blocks from the existing md. */
function parseRoutes(md) {
  const map = {}
  // Same CRLF tolerance as parseTopChunks (see the comment there).
  const lines = md.split(/\r?\n/)
  let cur = null
  for (const line of lines) {
    const h = line.match(/^###\s+(v?[\w][\w.-]*)\s+—\s+(\d{4}-\d{2}-\d{2})$/)
    if (h) {
      cur = h[1]
      map[cur] = []
      continue
    }
    if (!cur) continue
    // Row: | /busca | 1 | 261.1 | — |   (route rows never match the Top-chunks
    // numeric-first pattern, and chunk rows never match this one — safe to
    // share the ### header format with parseTopChunks.)
    const row = line.match(/^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*([^|]*)\s*\|$/)
    if (row) map[cur].push({ label: row[1].trim(), files: Number(row[2]), gzipKB: Number(row[3]) })
    else if (line.startsWith("## ")) cur = null
  }
  return map
}

function parseRows(md) {
  const rows = []
  const top = parseTopChunks(md)
  const routes = parseRoutes(md)
  for (const line of md.split(/\r?\n/)) {
    const mm = line.match(/^\|\s*(v?[\w][\w.-]*)\s*\|(.*)\|\s*$/)
    if (!mm) continue
    if (mm[1] === HEADER[0]) continue // header row (future-proof vs ASCII rename)
    const c = mm[2].split("|").map((s) => s.trim())
    if (c.length < 9) continue
    const f = (s) => (s === "—" || s === "" ? null : Number(s))
    const legacy = c.length < 11
    rows.push({
      version: mm[1],
      date: c[0],
      initialKB: f(c[1]),
      totalKB: f(c[3]),
      largestKB: legacy ? null : f(c[5]),
      maplibreKB: f(legacy ? c[5] : c[7]),
      rechartsKB: f(legacy ? c[6] : c[8]),
      framerKB: f(legacy ? c[7] : c[9]),
      ok: (legacy ? c[8] : c[11]) === "✅",
      topChunks: top[mm[1]] || [],
      routes: routes[mm[1]] || [],
    })
  }
  return rows
}

// Rolling branch rows (ci.yml budget job, push to main/develop): they track
// per-merge evolution and never represent a release — so they must NEVER be
// the baseline for a delta/gate/preview comparison (those always target the
// latest versioned RELEASE). `main` ranks first (newest), `develop` second;
// both above every versioned release.
const ROLLING_ROWS = new Set(["main", "develop"])
const isRollingRow = (v) => ROLLING_ROWS.has(String(v))

function verKey(v) {
  const s = String(v)
  // Rolling rows (ci.yml, push to main/develop): rank ABOVE every versioned
  // release so they stay at the top of the table and their Δ columns compare
  // against the row below them. Without this they would parse as 0.0.0 and
  // sink to the bottom with meaningless deltas.
  if (s === "main") return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, s]
  if (s === "develop") {
    return [Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER - 1, s]
  }
  const mm = s.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!mm) return [0, 0, 0, s]
  return [Number(mm[1]), Number(mm[2]), Number(mm[3]), s]
}
// Descending (newest first): semver prefix, then lexicographic for suffixes.
// "main" (Number.MAX_SAFE_INTEGER) ranks first, "develop" second.
function cmpVer(a, b) {
  const ka = verKey(a)
  const kb = verKey(b)
  for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i]
  return String(kb[3]).localeCompare(String(ka[3]))
}

const existing = fs.existsSync(REPORT) ? fs.readFileSync(REPORT, "utf8") : ""
const rows = parseRows(existing).filter((r) => r.version !== entry.version)

// ── --preview: PR comment body (read-only; NEVER touches docs/) ────────────
// Used by ci.yml on PRs: prints a delta table vs the last versioned release
// so bundle evolution is visible BEFORE merge. The comment workflow
// (bundle-preview-comment.yml) finds/updates the comment by the marker
// "## 📦 Bundle preview (PR)" — keep it stable.
if (preview) {
  // Baseline for the PR comparison: the latest VERSIONED release — rolling
  // main/develop rows track merges and must never be the comparison target.
  const baseline =
    [...rows].sort((a, b) => cmpVer(a.version, b.version)).find((r) => !isRollingRow(r.version)) ?? null
  const fmt = (v) => (v == null ? "—" : v.toFixed(1) + " KB")
  const delta = (cur, base) => {
    if (cur == null || base == null) return "—"
    const d = +(cur - base).toFixed(1)
    return (d > 0 ? "+" : "") + d.toFixed(1)
  }
  const row = (label, cur, base) =>
    `| ${label} | ${fmt(base)} | ${fmt(cur)} | ${delta(cur, base)} |`
  const lines = [
    "## 📦 Bundle preview (PR)",
    "",
    baseline
      ? `_Comparado ao último release: **${baseline.version}** (${baseline.date})_`
      : "_Nenhum release versionado ainda — esta comparação fica sem baseline até o primeiro release._",
    "",
    "| Métrica | Release | Preview | Δ |",
    "|---|---|---|---|",
    row("Initial JS (/)", entry.initialKB, baseline?.initialKB),
    row("Total JS", entry.totalKB, baseline?.totalKB),
    row("Maior chunk", entry.largestKB, baseline?.largestKB),
    row("Maplibre-gl", entry.maplibreKB, baseline?.maplibreKB),
    row("Recharts", entry.rechartsKB, baseline?.rechartsKB),
    row("Framer-motion", entry.framerKB, baseline?.framerKB),
    `| Gate | ${baseline?.ok ? "✅" : "—"} | ${entry.ok ? "✅" : "❌"} | — |`,
  ]
  if (Array.isArray(entry.topChunks) && entry.topChunks.length) {
    lines.push(
      "",
      "### Top 5 maiores chunks (preview)",
      "",
      "| # | Chunk | KB gzip |",
      "|---|---|---|",
    )
    entry.topChunks.forEach((c, i) => lines.push(`| ${i + 1} | ${c.label} | ${c.gzipKB.toFixed(1)} |`))
  }
  lines.push(
    "",
    "> Δ Framer mede o total gzip da lib (modais lazy), não o initial JS.",
  )
  if (Array.isArray(entry.routes) && entry.routes.length) {
    lines.push(
      "",
      "### Rotas (real transfer, preview)",
      "",
      "| Rota | Release | Preview | Δ |",
      "|---|---|---|---|",
    )
    for (const rt of entry.routes) {
      const base = baseline && baseline.routes ? baseline.routes.find((x) => x.label === rt.label) : null
      lines.push(
        `| ${rt.label} | ${fmt(base ? base.gzipKB : null)} | ${fmt(rt.gzipKB)} | ` +
          `${delta(rt.gzipKB, base ? base.gzipKB : null)} |`,
      )
    }
  }
  lines.push(
    "",
    "_Fonte: `ANALYZE=true next build --webpack` + `scripts/check-js-budget.mjs` (KB gzip). Este preview é read-only e não altera `docs/bundle-report.md`._",
  )
  // fs.writeSync (not console.log) + process.exit: stdout to a pipe is
  // flushed asynchronously in Node, and process.exit() can truncate it —
  // exactly how CI consumes this output (`node ... | tee bundle-preview.md`).
  fs.writeSync(1, lines.join("\n") + "\n")
  process.exit(0)
}

rows.push(entry)
rows.sort((a, b) => cmpVer(a.version, b.version))

const fmtDelta = (d) => (d == null ? "—" : (d > 0 ? "+" : "") + d.toFixed(1))
const table = rows.map((r, i) => {
  // Δ columns are DISPLAY-ONLY vs the row below (desc order) — so main's
  // displayed Δ is vs the develop row when one exists. The anti-regression
  // gate below compares against the latest RELEASE instead (releaseBaseline
  // skips rolling rows). The divergence is intentional: the table shows the
  // incremental last hop, the gate enforces the release target. Don't "fix".
  const prev = rows[i + 1] // next row is the older version (desc order)
  const dInit = prev && r.initialKB != null && prev.initialKB != null ? +(r.initialKB - prev.initialKB).toFixed(1) : null
  const dTotal = prev && r.totalKB != null && prev.totalKB != null ? +(r.totalKB - prev.totalKB).toFixed(1) : null
  const dLargest = prev && r.largestKB != null && prev.largestKB != null ? +(r.largestKB - prev.largestKB).toFixed(1) : null
  const dFramer = prev && r.framerKB != null && prev.framerKB != null ? +(r.framerKB - prev.framerKB).toFixed(1) : null
  return `| ${r.version} | ${r.date} | ${cell(r.initialKB)} | ${fmtDelta(dInit)} | ${cell(r.totalKB)} | ${fmtDelta(dTotal)} | ${cell(r.largestKB)} | ${fmtDelta(dLargest)} | ${cell(r.maplibreKB)} | ${cell(r.rechartsKB)} | ${cell(r.framerKB)} | ${fmtDelta(dFramer)} | ${r.ok ? "✅" : "❌"} |`
})  // Footer da seção de libs: as colunas de lib (Maplibre/Recharts/Framer)
  // medem o TOTAL gzip da lib no bundle — inclusive o que vive em modais
  // lazy — NÃO o initial JS de nenhuma rota. Presença no primeiro paint é
  // coberta pelo guard de lazy-load (check 5), não pela coluna da tabela.
  // Nota recorrente em code review: o Δ Framer era lido como regressão de
  // initial JS quando na verdade reflete só o peso total da lib.
  const LIBS_FOOTER =
    "> ℹ️ As colunas de libs (Maplibre/Recharts/Framer) medem o **total gzip da lib no bundle**, " +
    "incluindo o que vive em modais lazy — **Δ Framer, em particular, mede o total da lib, não o initial JS**. " +
    "Presença no primeiro paint é garantida pelo guard de lazy-load (check 5), não pela coluna."

  // Honest-baseline note: when the local webpack build cannot prerender (Next
  // 16.1.x E696 on this Windows worktree), the initial-JS metric comes from
  // the rootMainFiles FALLBACK, which is NOT comparable to the real transfer
  // of the previous versions (rootMainFiles counts framework chunks only).
  // Flag it so the Δ Init column is never misread as a genuine improvement.
  // CI (Linux) regenerates the real transfer at release time. Emitted as a
  // blockquote line only — never touches table cells, so parseRows round-trip
  // is unaffected.
  const INIT_FALLBACK_NOTE =
    m.initialSource !== "prerendered-html"
      ? `\n> ⚠️ Initial (/) de ${entry.version} veio do fallback rootMainFiles (build local sem prerender completo — bug E696 do Next no Windows); o Δ Init não é comparável ao real transfer das versões anteriores. O CI (Linux) regenera o real transfer no release.\n`
      : ""

  // Per-version "Top 5 maiores chunks" blocks (gzip KB, from the analyzer
  // chartData attribution) so the report shows WHICH chunk grew between
  // releases — not just the fixed per-library totals.
const topBlocks = rows
  .filter((r) => Array.isArray(r.topChunks) && r.topChunks.length > 0)
  .map((r) => {
    const lines = r.topChunks
      .map((c, i) => `| ${i + 1} | ${c.label} | ${c.gzipKB.toFixed(1)} |`)
      .join("\n")
    return `### ${r.version} — ${r.date}\n| # | Chunk | KB gzip |\n|---|---|---|\n${lines}`
  })

// Per-version "Rotas (real transfer)" blocks — the check-7 real first-paint
// bytes per key route (worst case over prerendered params), with Δ vs the
// previous version that tracked the same route. A route added later shows
// Δ — (no baseline) until it appears in two consecutive versions.
const routeBlocks = []
rows.forEach((r, i) => {
  if (!Array.isArray(r.routes) || r.routes.length === 0) return
  const prev = rows[i + 1] // next row is the older version (desc order)
  const lines = r.routes
    .map((rt) => {
      const pv = prev && prev.routes ? prev.routes.find((x) => x.label === rt.label) : null
      const d = pv && pv.gzipKB != null && rt.gzipKB != null ? +(rt.gzipKB - pv.gzipKB).toFixed(1) : null
      return `| ${rt.label} | ${rt.files} | ${cell(rt.gzipKB)} | ${fmtDelta(d)} |`
    })
    .join("\n")
  routeBlocks.push(`### ${r.version} — ${r.date}\n| Rota | Params | KB gzip | Δ |\n|---|---|---|---|\n${lines}`)
})

const md =
  "# Bundle Report — Severinno\n\n" +
  "> Gerado automaticamente a cada release pelo CI (job `budget`). Não editar manualmente.\n" +
  "> Fonte: `ANALYZE=true next build --webpack` + `scripts/check-js-budget.mjs` (KB gzip).\n" +
  "> Δ = variação vs a versão anterior da tabela.\n\n" +
  "## Histórico\n\n" +
  `| ${HEADER.join(" | ")} |\n` +
  `|${HEADER.map(() => "---").join("|")}|\n` +
  table.join("\n") +
  `\n\n${LIBS_FOOTER}${INIT_FALLBACK_NOTE}\n` +
  (topBlocks.length ? `\n## Top 5 maiores chunks (KB gzip)\n\n${topBlocks.join("\n\n")}\n` : "\n") +
  (routeBlocks.length
    ? `\n## Rotas (real transfer, KB gzip)\n\n${routeBlocks.join("\n\n")}\n`
    : "") +
  `\n_Última atualização: ${today} (${entry.version})_\n`

fs.mkdirSync(path.dirname(REPORT), { recursive: true })
fs.writeFileSync(REPORT, md)

// ── Shields.io endpoint badge (docs/bundle-badge.json) ─────────────────────
// Consumed by the README cover badge (https://img.shields.io/endpoint?url=…)
// so the repo shows the initial JS KB + gate of the LATEST release without
// hardcoding values in the README. Written only in write mode — --preview is
// read-only and never touches docs/ (verified by the read-only test).
// NOTE: the badge reflects the SIZE-GATE status of the latest release
// (entry.ok from check-js-budget), written BEFORE the anti-regression gate
// below — a main push blocked by the delta gate still leaves a green ✅
// badge. That is intentional: the badge documents the release's size gate,
// not per-merge anti-regression outcomes (those fail the CI job instead).
// Rolling-row writes (--version develop) overwrite the badge with the
// branch's own values and commit it on develop; the README endpoint resolves
// from main, so it self-corrects on the next main push — the badge is only
// meaningful on the deployed branch.
const BADGE = path.join(ROOT, "docs", "bundle-badge.json")
const badge = {
  schemaVersion: 1,
  label: "bundle",
  message: `${cell(entry.initialKB)} KB ${entry.ok ? "✅" : "❌"}`,
  color: entry.ok ? "green" : "red",
}
fs.writeFileSync(BADGE, JSON.stringify(badge, null, 2) + "\n")

// ── Anti-regression gate (rolling "main" row) ───────────────────────────────
// The 'main' row (ci.yml, push to main) is not just tracking — it is a GATE:
// if the merged bundle's Initial JS (/) or Total worsened by more than the
// threshold vs the last versioned release, the budget job FAILS (exit 1). This
// turns per-merge tracking into an anti-regression gate on push to main: a
// +50 KB first-paint regression can no longer ride a merge into the report.
// Thresholds in KB gzip, env-overridable (policy mirrored in ci.yml):
//   JS_BUDGET_MAIN_DELTA_INITIAL_KB  (default 50)
//   JS_BUDGET_MAIN_DELTA_TOTAL_KB    (default 200)
// Only evaluated for the rolling "main" row — releases define the baseline,
// so comparing a release against itself makes no sense. Skipped when the
// initial metric came from the rootMainFiles FALLBACK (non-comparable — same
// honesty rule as INIT_FALLBACK_NOTE) or when there is no versioned baseline
// yet (first-ever main run). Report + badge are written BEFORE this check so
// CI's always() commit step still records the regressed row.
//
// Comparison is STRICTLY GREATER than the threshold (>) — a regression
// exactly equal to the limit (e.g. +50.0 KB initial) passes. If a hard
// "no worse than X" ceiling is wanted, lower the policy env by the rounding
// granularity (0.1 KB). Consistent with the size gate's > semantics.
// numEnv: a threshold of 0 / negative / NaN falls back to the default — a
// "block ANY positive regression" (0) policy is intentionally NOT expressible
// via env; use a tiny positive value like 0.05 for that intent.
const MAIN_DELTA_INITIAL_KB = numEnv(process.env.JS_BUDGET_MAIN_DELTA_INITIAL_KB, 50)
const MAIN_DELTA_TOTAL_KB = numEnv(process.env.JS_BUDGET_MAIN_DELTA_TOTAL_KB, 200)
// Per-route real-transfer deltas (check 7): a route that worsens 30 KB on a
// merge WITHOUT touching / initial would escape the Initial/Total gate alone,
// so the 'main' gate also enforces per-route thresholds. Default 30 KB per
// route (KB gzip), env-overridable (policy mirrored in ci.yml). Keyed by the
// same labels as REAL_ROUTE_CHECKS / the report's "Rotas" blocks. A route
// with no configured threshold (future REAL_ROUTE_CHECKS entry not yet in
// this map) is measured and REPORTED but not gated until a policy is added.
//
// SEMANTICS: realRoutes is worst-case-over-prerendered-params (Math.max over
// the per-param transfers, check 7). A build that prerenders a heavier new
// param can legitimately jump a route's delta > 30 KB without a code change
// — that is DESIRED (a heavier param IS a regression for that route's users),
// not flakiness. Don't "fix" a param-driven jump by raising the threshold.
const ROUTE_DELTA_KB = {
  "/busca": numEnv(process.env.JS_BUDGET_MAIN_DELTA_ROUTE_BUSCA_KB, 30),
  "/dashboard": numEnv(process.env.JS_BUDGET_MAIN_DELTA_ROUTE_DASHBOARD_KB, 30),
  "/u/[slug]": numEnv(process.env.JS_BUDGET_MAIN_DELTA_ROUTE_U_KB, 30),
  "/categoria/[slug]": numEnv(process.env.JS_BUDGET_MAIN_DELTA_ROUTE_CATEGORIA_KB, 30),
}
// Baseline for the main gate: the latest VERSIONED release. Rolling rows
// (main/develop) are explicitly EXCLUDED — once a develop row exists in the
// report, the gate must still compare against the release, not against
// develop (develop is WIP and can legitimately carry a regression).
const releaseBaseline =
  entry.version === "main" ? rows.find((r) => !isRollingRow(r.version)) : null
// Single source of truth for the deltas — used BOTH by the gate comparison
// below AND by the observability log, so a future edit to one can never
// silently desync the logged value from the compared value.
// Rounded at the DISPLAYED 0.1 KB granularity: an exact-equal delta
// (e.g. +7.9 KB vs limite +7.9 KB) must pass per the strictly-greater
// contract as a human reads the report. Raw doubles (87.9 - 80 =
// 7.9000000000000004) would otherwise falsely block a merge whose delta is
// exactly at the limit. (No false-negative window: entry metrics and the
// parsed baseline are both already 1-decimal, so genuine deltas are always
// multiples of 0.1 — only float noise lands in-between, which this absorbs.)
const gdInit =
  entry.version === "main" && releaseBaseline && entry.initialKB != null && releaseBaseline.initialKB != null
    ? +(entry.initialKB - releaseBaseline.initialKB).toFixed(1)
    : null
const gdTotal =
  entry.version === "main" && releaseBaseline && entry.totalKB != null && releaseBaseline.totalKB != null
    ? +(entry.totalKB - releaseBaseline.totalKB).toFixed(1)
    : null
// Per-route deltas vs the release baseline — the SAME 0.1-KB float-safe
// rounding as gdInit/gdTotal. Only routes with a measured value on BOTH sides
// are compared; a route that exists in only one (newly added since the
// release, or removed) has no comparable delta and is skipped silently.
const gdRoutes =
  entry.version === "main" &&
  releaseBaseline &&
  Array.isArray(entry.routes) &&
  Array.isArray(releaseBaseline.routes)
    ? entry.routes
        .map((rt) => {
          const base = releaseBaseline.routes.find((x) => x.label === rt.label)
          if (!base || base.gzipKB == null || rt.gzipKB == null) return null
          return { label: rt.label, delta: +(rt.gzipKB - base.gzipKB).toFixed(1), base: base.gzipKB, cur: rt.gzipKB }
        })
        .filter((x) => x !== null)
    : []
if (entry.version === "main" && releaseBaseline && m.initialSource === "prerendered-html") {
  const dInit = gdInit
  if (dInit != null && dInit > MAIN_DELTA_INITIAL_KB) {
    console.error(
      `❌ ANTI-REGRESSION GATE: 'main' Initial JS (/) piorou +${dInit.toFixed(1)} KB vs ` +
        `${releaseBaseline.version} (${releaseBaseline.initialKB.toFixed(1)} → ${entry.initialKB.toFixed(1)} KB; ` +
        `limite +${MAIN_DELTA_INITIAL_KB} KB). Bloqueado — reduza o initial JS antes do merge.`,
    )
    process.exit(1)
  }
  const dTotal = gdTotal
  if (dTotal != null && dTotal > MAIN_DELTA_TOTAL_KB) {
    console.error(
      `❌ ANTI-REGRESSION GATE: 'main' Total piorou +${dTotal.toFixed(1)} KB vs ` +
        `${releaseBaseline.version} (${releaseBaseline.totalKB.toFixed(1)} → ${entry.totalKB.toFixed(1)} KB; ` +
        `limite +${MAIN_DELTA_TOTAL_KB} KB). Bloqueado — reduza o bundle total antes do merge.`,
    )
    process.exit(1)
  }
  // Per-route real-transfer regressions — checked AFTER initial/total so the
  // most severe message wins when multiple gates trip; each failing route is
  // reported before exit.
  for (const gd of gdRoutes) {
    const limit = ROUTE_DELTA_KB[gd.label]
    if (limit == null) continue // measured but no policy yet → report only
    if (gd.delta > limit) {
      console.error(
        `❌ ANTI-REGRESSION GATE: 'main' rota ${gd.label} piorou +${gd.delta.toFixed(1)} KB vs ` +
          `${releaseBaseline.version} (${gd.base.toFixed(1)} → ${gd.cur.toFixed(1)} KB; ` +
          `limite +${limit.toFixed(1)} KB). Bloqueado — reduza o real transfer da rota antes do merge.`,
      )
      process.exit(1)
    }
  }
}

// Observability: the CI log must show whether the gate was evaluated and its
// delta — or why it was skipped (fallback metric / no versioned baseline) —
// otherwise a green run is indistinguishable from a silent skip. Rolling
// rows: main gets the gate; develop is tracking-only (no gate by design).
if (entry.version === "develop") {
  console.log(
    "   gate anti-regressão: n/a — develop é tracking-only (o gate bloqueia só push em main)",
  )
} else if (entry.version === "main") {
  if (!releaseBaseline) {
    // rows here already contains the pushed entry — but releaseBaseline is
    // null, so no prior row is a versioned release. rows.length > 1 means
    // prior ROLLING rows exist (develop history) vs a true first-ever run.
    console.log(
      rows.length > 1
        ? "   gate anti-regressão: skipped — sem release versionado ainda (só linhas rolling main/develop; o gate compara só vs releases)"
        : "   gate anti-regressão: skipped — sem baseline versionado (primeiro run de main?)",
    )
  } else if (m.initialSource !== "prerendered-html") {
    console.log(
      "   gate anti-regressão: skipped — initial veio do fallback rootMainFiles (métrica não comparável)",
    )
  } else {
    const sign = (d) => (d == null ? "—" : (d > 0 ? "+" : "") + d.toFixed(1))
    // Distinguish "rotas dentro do limite" from "sem baseline por rota ainda"
    // (releases antigos — v0.4.0/v0.4.1 — não têm blocos Rotas no markdown, e
    // rotas novas só passam a ser comparadas quando o baseline as registra).
    // Sem isto, o log silenciosamente omite rotas no primeiro run pós-change,
    // indistinguível de "nenhuma rota medida".
    const routeLog = gdRoutes.length
      ? ", rotas: " + gdRoutes.map((g) => `${g.label} ${sign(g.delta)} KB`).join(", ")
      : Array.isArray(entry.routes) && entry.routes.length > 0
        ? ", rotas: n/a — sem baseline por rota ainda"
        : ""
    console.log(
      `   gate anti-regressão: ok (Δ initial ${sign(gdInit)} KB, Δ total ${sign(gdTotal)} KB${routeLog} vs ${releaseBaseline.version})`,
    )
  }
}
console.log(`✅ bundle-report: ${entry.version} registrado em docs/bundle-report.md (+ docs/bundle-badge.json)`)
console.log(
  `   initial ${cell(entry.initialKB)} KB | total ${cell(entry.totalKB)} KB | ` +
    `maplibre ${cell(entry.maplibreKB)} KB | recharts ${cell(entry.rechartsKB)} KB | framer ${cell(entry.framerKB)} KB | gate ${entry.ok ? "✅" : "❌"}`,
)
