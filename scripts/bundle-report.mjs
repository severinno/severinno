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
  const lines = md.split("\n")
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
  const lines = md.split("\n")
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
  for (const line of md.split("\n")) {
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

function verKey(v) {
  const s = String(v)
  // Rolling "main" row (ci.yml, push to main): ranks ABOVE every versioned
  // release so it stays at the top of the table and its Δ columns compare
  // against the latest release (the row below it). Without this it would
  // parse as 0.0.0 and sink to the bottom with meaningless deltas.
  if (s === "main") return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, s]
  const mm = s.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!mm) return [0, 0, 0, s]
  return [Number(mm[1]), Number(mm[2]), Number(mm[3]), s]
}
// Descending (newest first): semver prefix, then lexicographic for suffixes.
// "main" (Number.MAX_SAFE_INTEGER) always ranks first.
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
  const baseline = [...rows].sort((a, b) => cmpVer(a.version, b.version))[0] ?? null
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
const BADGE = path.join(ROOT, "docs", "bundle-badge.json")
const badge = {
  schemaVersion: 1,
  label: "bundle",
  message: `${cell(entry.initialKB)} KB ${entry.ok ? "✅" : "❌"}`,
  color: entry.ok ? "green" : "red",
}
fs.writeFileSync(BADGE, JSON.stringify(badge, null, 2) + "\n")

console.log(`✅ bundle-report: ${entry.version} registrado em docs/bundle-report.md (+ docs/bundle-badge.json)`)
console.log(
  `   initial ${cell(entry.initialKB)} KB | total ${cell(entry.totalKB)} KB | ` +
    `maplibre ${cell(entry.maplibreKB)} KB | recharts ${cell(entry.rechartsKB)} KB | framer ${cell(entry.framerKB)} KB | gate ${entry.ok ? "✅" : "❌"}`,
)
