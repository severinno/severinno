#!/usr/bin/env node
/**
 * lhci-monitor.mjs — Core Web Vitals flake monitor for Lighthouse CI.
 *
 * Aggregates LHCI filesystem reports (per-run *.report.json) grouped by URL
 * and compares the 5 audited CWV metrics against the assertion thresholds in
 * lighthouserc.json / lighthouserc.mobile.json.
 *
 * Semantics (matches how `lhci assert` actually evaluates):
 *   - GATE-FAIL — the REPRESENTATIVE run's value exceeds an ERROR threshold.
 *     `lhci assert` picks one representative run per URL (the run with the
 *     median performance score) and asserts all metrics on that single run.
 *     This is the signal that would have failed the CI gate — the one that
 *     should drive a mitigation decision (numberOfRuns, throttling, runner).
 *   - SPIKE     — an individual run exceeded the limit but the representative
 *     run did not (the gate passed). Informational — early flake evidence.
 *   - NEAR      — the per-URL max sits within --margin % of an ERROR limit
 *     (flake risk zone, even though no run went over yet).
 *
 * Two input modes:
 *   default      — scan a local reports dir (--dir, default ./lhci-reports)
 *   --fetch N    — download the last N runs of the Lighthouse CI workflow(s)
 *                  via the gh CLI (artifacts lhci-reports + lhci-reports-
 *                  mobile) into a temp dir and analyze them together. By
 *                  default queries BOTH lighthouse-ci.yml (push-to-main/PR)
 *                  AND release-deploy.yml (v* tag releases, where the LHCI
 *                  now runs via workflow_call and is the deploy gate).
 *
 * Exit codes: 0 = no gate-fail, 1 = at least one GATE-FAIL (usable as a
 *             gate), 2 = no report files found.
 *
 * Usage:
 *   node scripts/lhci-monitor.mjs                        # desktop local dir
 *   node scripts/lhci-monitor.mjs --mobile               # mobile local dir
 *   node scripts/lhci-monitor.mjs --fetch 10             # last 10 CI runs (main)
 *   node scripts/lhci-monitor.mjs --fetch 10 --branch feat/x
 *   node scripts/lhci-monitor.mjs --workflow lighthouse-ci.yml --fetch 10
 *   node scripts/lhci-monitor.mjs --margin 25            # near-miss window 25%
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();

// lighthouserc assertion keys are the Lighthouse audit ids themselves.
const AUDIT_IDS = new Set([
  'first-contentful-paint',
  'largest-contentful-paint',
  'cumulative-layout-shift',
  'speed-index',
  'total-blocking-time',
]);

const DESKTOP_CONFIG = 'lighthouserc.json';
const MOBILE_CONFIG = 'lighthouserc.mobile.json';
const DESKTOP_DIR = 'lhci-reports';
const MOBILE_DIR = 'lhci-reports-mobile';
const DEFAULT_WORKFLOWS = ['lighthouse-ci.yml', 'release-deploy.yml'];

function log(msg, opts = {}) {
  if (!opts.quiet) console.log(msg);
}

function printHelp() {
  console.log(`
lhci-monitor.mjs — CWV flake monitor for Lighthouse CI

Usage:
  node scripts/lhci-monitor.mjs [options]

Options:
  --dir <path>       reports dir to scan (default: ./lhci-reports)
  --mobile           use the mobile config + ./lhci-reports-mobile
  --fetch <n>        download the last <n> CI runs via gh and analyze both
                     desktop + mobile artifacts (default branch: main)
  --branch <name>    filter lighthouse-ci.yml runs to a branch (default: main).
                     release-deploy.yml runs are always fetched WITHOUT a branch
                     filter — tag pushes have head_branch null in the GitHub
                     API, so filtering would exclude the v* release runs
  --workflow <file>  restrict --fetch to one workflow (repeatable). Default:
                     lighthouse-ci.yml + release-deploy.yml (the latter covers
                     v* tag releases, where LHCI runs via workflow_call and
                     blocks the deploy)
  --margin <pct>     near-miss window vs ERROR threshold (default: 20)
  --quiet            suppress the table, print only the verdict line
  --help, -h         show this help

Verdict semantics (same as \`lhci assert\`):
  GATE-FAIL = the representative run (median performance score per URL)
              exceeds an ERROR limit (the gate would fail — drive mitigation
              from this)
  SPIKE     = an individual run above the limit, representative OK (gate passed)
  NEAR      = max within --margin % of an ERROR limit (risk zone)

Exit codes:
  0  no gate-fail
  1  at least one GATE-FAIL
  2  no report files found
`);
}

function parseArgs(argv) {
  const args = { dir: null, mobile: false, fetch: 0, branch: 'main', workflows: null, marginPct: 20, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') args.dir = argv[++i];
    else if (a === '--mobile') args.mobile = true;
    else if (a === '--fetch') args.fetch = Number(argv[++i]) || 0;
    else if (a === '--branch') args.branch = argv[++i];
    else if (a === '--workflow') {
      args.workflows = args.workflows || [];
      args.workflows.push(argv[++i]);
    } else if (a === '--margin') args.marginPct = Number(argv[++i]) || 20;
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else {
      console.error(`Unknown option: ${a} (use --help)`);
      process.exit(2);
    }
  }
  return args;
}

function loadThresholds(mobile) {
  const cfgPath = path.join(ROOT, mobile ? MOBILE_CONFIG : DESKTOP_CONFIG);
  if (!fs.existsSync(cfgPath)) return {};
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const assertions = cfg.ci?.assert?.assertions || {};
  const out = {};
  for (const [key, spec] of Object.entries(assertions)) {
    if (!AUDIT_IDS.has(key)) continue;
    const level = Array.isArray(spec) ? spec[0] : spec.level || 'warn';
    const max = Array.isArray(spec) ? spec[1]?.maxNumericValue : spec.maxNumericValue;
    if (typeof max === 'number') out[key] = { level, max };
  }
  return out;
}

// Returns [{ file, url, fetchTime, perfScore, metrics: {auditId: value} }]
function collectRunsFromDir(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.report.json'));
  const runs = [];
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const url = r.finalDisplayedUrl || r.requestedUrl || '';
      if (!url) continue;
      const metrics = {};
      for (const auditId of AUDIT_IDS) {
        const v = r.audits?.[auditId]?.numericValue;
        if (typeof v === 'number') metrics[auditId] = v;
      }
      runs.push({
        file: f,
        url,
        fetchTime: r.fetchTime || '',
        perfScore: typeof r.categories?.performance?.score === 'number' ? r.categories.performance.score : null,
        metrics,
      });
    } catch (err) {
      log(`  ⚠ skipping ${f}: ${err.message}`, { quiet: false });
    }
  }
  return runs;
}

function normalizePath(u) {
  try {
    const p = new URL(u).pathname;
    return p === '/' ? '/' : p.replace(/\/+$/, '');
  } catch {
    return u;
  }
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// The run with the median performance score — the same selection `lhci
// assert` uses for the representative run. Falls back to null when no run
// exposes a performance category (then per-metric medians are used instead).
function selectRepresentative(urlRuns) {
  const scored = urlRuns.filter((r) => typeof r.perfScore === 'number');
  if (!scored.length) return null;
  scored.sort((a, b) => a.perfScore - b.perfScore);
  return scored[Math.floor(scored.length / 2)];
}

function fmtMs(v) {
  return `${(v / 1000).toFixed(2)}s`;
}

// Analyze one set of runs against its thresholds.
// Returns { label, rows, gateFails, spikes, nears, runsCount, urls }
function analyze({ label, runs, thresholds, marginPct }) {
  const byUrl = new Map();
  for (const run of runs) {
    const u = normalizePath(run.url);
    if (!byUrl.has(u)) byUrl.set(u, []);
    byUrl.get(u).push(run);
  }
  const rows = [];
  const gateFails = [];
  const spikes = [];
  const nears = [];
  for (const [url, urlRuns] of byUrl) {
    const rep = selectRepresentative(urlRuns);
    for (const [auditId, { level, max }] of Object.entries(thresholds)) {
      const values = urlRuns.map((r) => r.metrics[auditId]).filter((v) => typeof v === 'number');
      if (values.length === 0) continue;
      const min = Math.min(...values);
      const maxV = Math.max(...values);
      const med = median(values);
      // `lhci assert` checks the representative run; fall back to the metric
      // median only when no performance score is available.
      const repVal =
        rep && typeof rep.metrics[auditId] === 'number' ? rep.metrics[auditId] : med;
      // CLS is unitless; the remaining audited metrics are milliseconds.
      const isCls = auditId === 'cumulative-layout-shift';
      const headroomPct = max ? ((max - maxV) / max) * 100 : 100;
      let risk = 'OK';
      if (level === 'error' && repVal > max) {
        risk = 'GATE-FAIL';
        gateFails.push({ url, auditId, isCls, repVal, max });
      } else if (level === 'error' && maxV > max) {
        risk = 'SPIKE';
        spikes.push({ url, auditId, isCls, maxV, repVal, max, headroomPct });
      } else if (level === 'error' && maxV >= max * (1 - marginPct / 100)) {
        risk = 'NEAR';
        nears.push({ url, auditId, isCls, maxV, max, headroomPct });
      }
      rows.push({
        url,
        auditId,
        label: auditId.replace(/-/g, ' '),
        level,
        max,
        min,
        med,
        maxV,
        isCls,
        headroomPct,
        risk,
        n: values.length,
      });
    }
  }
  return { label, rows, gateFails, spikes, nears, runsCount: runs.length, urls: [...byUrl.keys()] };
}

function printReport(res, opts) {
  const { label, rows, gateFails, spikes, nears, runsCount, urls } = res;
  log(`\n=== ${label} (${runsCount} run${runsCount === 1 ? '' : 's'}, ${urls.length} URL${urls.length === 1 ? '' : 's'}) ===`, opts);
  if (rows.length === 0) {
    log('  (no auditable runs found)', opts);
    return;
  }
  const fmtV = (v, isCls) => (isCls ? v.toFixed(3) : fmtMs(v));
  const header = 'URL'.padEnd(28) + 'metric'.padEnd(24) + 'n'.padEnd(3) + 'min'.padEnd(9) + 'median'.padEnd(9) + 'max'.padEnd(9) + 'limit'.padEnd(10) + 'headroom'.padEnd(10) + 'risk';
  log(header, opts);
  log('-'.repeat(header.length), opts);
  for (const r of rows) {
    log(
      r.url.padEnd(28) +
        r.label.padEnd(24) +
        String(r.n).padEnd(3) +
        fmtV(r.min, r.isCls).padEnd(9) +
        fmtV(r.med, r.isCls).padEnd(9) +
        fmtV(r.maxV, r.isCls).padEnd(9) +
        fmtV(r.max, r.isCls).padEnd(10) +
        `${r.headroomPct >= 0 ? '+' : ''}${r.headroomPct.toFixed(0)}%`.padEnd(10) +
        r.risk,
      opts
    );
  }
  if (gateFails.length) {
    log(`\n  🚨 GATE-FAIL (${gateFails.length}) — representative run above the ERROR limit, the CI gate would fail:`, opts);
    for (const f of gateFails) {
      log(`    ${f.url} — ${f.auditId} representative ${f.isCls ? f.repVal.toFixed(3) : fmtMs(f.repVal)} > limit ${f.max}`, opts);
    }
  }
  if (spikes.length) {
    log(`\n  ⚠ SPIKE (${spikes.length}) — a run went over but the representative run is OK (gate passed; flake evidence):`, opts);
    for (const s of spikes) {
      log(`    ${s.url} — ${s.auditId} max ${s.isCls ? s.maxV.toFixed(3) : fmtMs(s.maxV)} > limit ${s.max} (representative ${s.isCls ? s.repVal.toFixed(3) : fmtMs(s.repVal)})`, opts);
    }
  }
  if (nears.length) {
    log(`\n  ⚠ NEAR (${nears.length}) — max within ${opts.marginPct}% of an ERROR limit:`, opts);
    for (const n of nears) {
      log(`    ${n.url} — ${n.auditId} max ${n.isCls ? n.maxV.toFixed(3) : fmtMs(n.maxV)} (limit ${n.max}, +${n.headroomPct.toFixed(0)}% headroom)`, opts);
    }
  }
}

function gh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : err.message;
    throw new Error(`gh ${args.join(' ')} failed: ${stderr}`);
  }
}

// Download artifacts of the last N runs of the given workflows (on a branch)
// into a temp dir. Returns { desktopRuns, mobileRuns, entries } where each
// entry is { id, workflow, conclusion, branch, event, createdAt, runCount }.
// The temp dir is removed before returning. Runs that fail to list/download
// are skipped with a warning (per-workflow, per-artifact).
function fetchCIRuns(n, branch, workflows) {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'lhci-monitor-'));
  try {
    const desktopRuns = [];
    const mobileRuns = [];
    const entries = [];
    const seen = new Set();
    for (const workflow of workflows) {
      let list;
      // Tag-triggered runs (v* releases, the deploy-blocking LHCI gate) have
      // head_branch: null in the GitHub API — a --branch filter would silently
      // exclude release-deploy.yml runs. Apply the filter only to
      // lighthouse-ci.yml (push-to-main / PR); fetch release-deploy.yml runs
      // unfiltered (tags + workflow_dispatch have no meaningful branch).
      const listArgs = ['run', 'list', '--workflow', workflow];
      if (!workflow.includes('release-deploy')) listArgs.push('--branch', branch);
      listArgs.push('--limit', String(n), '--json', 'databaseId,conclusion,event,headBranch,createdAt');
      try {
        list = JSON.parse(gh(listArgs));
      } catch (err) {
        log(`  ⚠ could not list runs for ${workflow}: ${err.message.split(':').pop().trim()}`, { quiet: false });
        continue;
      }
      for (const run of list) {
        const id = String(run.databaseId);
        if (seen.has(id)) continue;
        seen.add(id);
        const dir = path.join(tmpBase, id);
        fs.mkdirSync(dir, { recursive: true });
        for (const artifact of ['lhci-reports', 'lhci-reports-mobile']) {
          try {
            gh(['run', 'download', id, '-n', artifact, '-D', dir]);
          } catch (err) {
            log(`  ⚠ run ${id}: no ${artifact} artifact (${err.message.split(':').pop().trim()})`, { quiet: false });
          }
        }
        const desktop = collectRunsFromDir(path.join(dir, 'lhci-reports'));
        const mobile = collectRunsFromDir(path.join(dir, 'lhci-reports-mobile'));
        desktopRuns.push(...desktop);
        mobileRuns.push(...mobile);
        entries.push({
          id,
          workflow,
          conclusion: run.conclusion || 'in_progress',
          branch: run.headBranch,
          event: run.event,
          createdAt: run.createdAt,
          runCount: desktop.length + mobile.length,
        });
      }
    }
    if (!entries.length) {
      throw new Error(`No runs found for ${workflows.join(', ')} on branch "${branch}"`);
    }
    return { desktopRuns, mobileRuns, entries };
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  let results = [];

  if (opts.fetch > 0) {
    const workflows = opts.workflows || DEFAULT_WORKFLOWS;
    log(`Fetching last ${opts.fetch} runs of ${workflows.join(', ')} (branch filter "${opts.branch}" applies to lighthouse-ci.yml only) via gh…`, opts);
    let fetched;
    try {
      fetched = fetchCIRuns(opts.fetch, opts.branch, workflows);
    } catch (err) {
      // Distinguish "no data / gh failure" (exit 2) from a real GATE-FAIL (exit 1).
      console.error(`Could not fetch CI runs: ${err.message} (exit 2).`);
      process.exit(2);
    }
    const { desktopRuns, mobileRuns, entries } = fetched;
    log('\nRuns fetched:', opts);
    for (const e of entries) {
      log(`  #${e.id} ${e.conclusion.padEnd(12)} ${e.branch.padEnd(20)} ${e.event.padEnd(12)} ${e.createdAt} (${e.runCount} reports)`, opts);
    }
    results.push(analyze({ label: 'DESKTOP (CI, fetched runs)', runs: desktopRuns, thresholds: loadThresholds(false), marginPct: opts.marginPct }));
    results.push(analyze({ label: 'MOBILE (CI, fetched runs)', runs: mobileRuns, thresholds: loadThresholds(true), marginPct: opts.marginPct }));
  } else if (opts.mobile) {
    const dir = opts.dir || path.join(ROOT, MOBILE_DIR);
    const runs = collectRunsFromDir(dir);
    results.push(analyze({ label: 'MOBILE (local)', runs, thresholds: loadThresholds(true), marginPct: opts.marginPct }));
  } else {
    const dir = opts.dir || path.join(ROOT, DESKTOP_DIR);
    const runs = collectRunsFromDir(dir);
    results.push(analyze({ label: 'DESKTOP (local)', runs, thresholds: loadThresholds(false), marginPct: opts.marginPct }));
  }

  const totalRuns = results.reduce((acc, r) => acc + r.runsCount, 0);
  if (totalRuns === 0) {
    console.error('No *.report.json files found — nothing to analyze (exit 2).');
    process.exit(2);
  }

  for (const res of results) printReport(res, opts);

  const allGateFails = results.flatMap((r) => r.gateFails);
  const allSpikes = results.flatMap((r) => r.spikes);
  const allNears = results.flatMap((r) => r.nears);
  const verdict =
    allGateFails.length === 0
      ? `✅ No gate-fail — ${totalRuns} runs across ${results.length} preset(s).`
      : `🚨 ${allGateFails.length} GATE-FAIL(s) across ${totalRuns} runs — the CI gate would have failed.`;
  console.log(`\n${verdict}`);
  if (allSpikes.length) {
    console.log(`⚠ ${allSpikes.length} spike(s) (runs over the limit, representative OK) — flake evidence, watch the next runs.`);
  }
  if (allNears.length) {
    console.log(`⚠ ${allNears.length} near-miss(es) within ${opts.marginPct}% of an ERROR limit — monitor these metrics on the next runs.`);
  }
  process.exit(allGateFails.length ? 1 : 0);
}

main();
