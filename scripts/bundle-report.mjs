#!/usr/bin/env node
/**
 * Versioned bundle report generator — Severinno
 *
 * Runs `scripts/check-js-budget.mjs --json` (requires a fresh
 * `ANALYZE=true next build --webpack` so .next/analyze/client.html +
 * .next/server/app/index.html exist), then upserts a row for the current
 * version into `docs/bundle-report.md`, tracking the evolution of
 * initial/total/per-library sizes across releases with deltas vs the previous
 * version.
 *
 * Usage:
 *   node scripts/bundle-report.mjs --version v0.4.0   # explicit version
 *   node scripts/bundle-report.mjs                    # git tag → package.json
 *
 * CI wiring: run after `bun run budget:js` in the release `budget` job; commit
 * the generated docs/bundle-report.md on tag pushes (see release-deploy.yml).
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
  maplibreKB: num(m.libs?.["maplibre-gl"]?.gzipKB),
  rechartsKB: num(m.libs?.recharts?.gzipKB),
  framerKB: num(m.libs?.["framer-motion"]?.gzipKB),
  ok: !!m.ok,
}

// ── Read existing history (docs/bundle-report.md table) ─────────────────────
// Columns: Versão | Data | Initial (/) | Δ Init | Total | Δ Total | Maplibre |
//          Recharts | Framer | Gate
const HEADER = ["Versão", "Data", "Initial (/)", "Δ Init", "Total", "Δ Total", "Maplibre", "Recharts", "Framer", "Gate"]

function parseRows(md) {
  const rows = []
  for (const line of md.split("\n")) {
    const mm = line.match(/^\|\s*(v?[\w][\w.-]*)\s*\|(.*)\|\s*$/)
    if (!mm) continue
    if (mm[1] === HEADER[0]) continue // header row (future-proof vs ASCII rename)
    const c = mm[2].split("|").map((s) => s.trim())
    if (c.length < 9) continue
    const f = (s) => (s === "—" || s === "" ? null : Number(s))
    rows.push({
      version: mm[1],
      date: c[0],
      initialKB: f(c[1]),
      totalKB: f(c[3]),
      maplibreKB: f(c[5]),
      rechartsKB: f(c[6]),
      framerKB: f(c[7]),
      ok: c[8] === "✅",
    })
  }
  return rows
}

function verKey(v) {
  const mm = String(v).replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!mm) return [0, 0, 0, String(v)]
  return [Number(mm[1]), Number(mm[2]), Number(mm[3]), String(v)]
}
// Descending (newest first): semver prefix, then lexicographic for suffixes.
function cmpVer(a, b) {
  const ka = verKey(a)
  const kb = verKey(b)
  for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i]
  return String(kb[3]).localeCompare(String(ka[3]))
}

const existing = fs.existsSync(REPORT) ? fs.readFileSync(REPORT, "utf8") : ""
const rows = parseRows(existing).filter((r) => r.version !== entry.version)
rows.push(entry)
rows.sort((a, b) => cmpVer(a.version, b.version))

const fmtDelta = (d) => (d == null ? "—" : (d > 0 ? "+" : "") + d.toFixed(1))
const table = rows.map((r, i) => {
  const prev = rows[i + 1] // next row is the older version (desc order)
  const dInit = prev && r.initialKB != null && prev.initialKB != null ? +(r.initialKB - prev.initialKB).toFixed(1) : null
  const dTotal = prev && r.totalKB != null && prev.totalKB != null ? +(r.totalKB - prev.totalKB).toFixed(1) : null
  return `| ${r.version} | ${r.date} | ${cell(r.initialKB)} | ${fmtDelta(dInit)} | ${cell(r.totalKB)} | ${fmtDelta(dTotal)} | ${cell(r.maplibreKB)} | ${cell(r.rechartsKB)} | ${cell(r.framerKB)} | ${r.ok ? "✅" : "❌"} |`
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
  `\n\n_Última atualização: ${today} (${entry.version})_\n`

fs.mkdirSync(path.dirname(REPORT), { recursive: true })
fs.writeFileSync(REPORT, md)
console.log(`✅ bundle-report: ${entry.version} registrado em docs/bundle-report.md`)
console.log(
  `   initial ${cell(entry.initialKB)} KB | total ${cell(entry.totalKB)} KB | ` +
    `maplibre ${cell(entry.maplibreKB)} KB | recharts ${cell(entry.rechartsKB)} KB | framer ${cell(entry.framerKB)} KB | gate ${entry.ok ? "✅" : "❌"}`,
)
