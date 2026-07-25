#!/usr/bin/env node
// ============================================================================
// Severinno Marketplace — Web Dashboard (SSE real-time)
// ============================================================================
// Início:    node scripts/web-dashboard.js
// Acessar:   http://localhost:3456
//
// Server-Sent Events: /events  (stream de JSON a cada 3s)
// ============================================================================

const http = require('http');
const { execFile } = require('child_process');
const path = require('path');

const PORTS = [3456, 3457, 3458, 3459, 3460];
let PORT = PORTS[0];
const INTERVAL_MS = 3000;

// ── Script paths (resolve relative to project root) ─────────────────────
const SCRIPT_DIR = __dirname;
const PROJECT_DIR = path.resolve(SCRIPT_DIR, '..');
const DASHBOARD_SH = path.join(SCRIPT_DIR, 'dashboard.sh');

// ── Latest cached JSON ─────────────────────────────────────────────────
let latestJson = '{}';
let clients = [];
let currentPortIndex = 0;

// ── Run dashboard.sh --json and cache result ──────────────────────────
function fetchStatus() {
    return new Promise((resolve) => {
        execFile('bash', [DASHBOARD_SH, '--json'], {
            cwd: PROJECT_DIR,
            timeout: 10000,
            maxBuffer: 1024 * 1024,
        }, (err, stdout) => {
            if (err) {
                // Return error JSON so the dashboard shows service status
                const errorPayload = JSON.stringify({
                    timestamp: new Date().toISOString(),
                    error: true,
                    message: err.message || 'Failed to fetch status',
                    containers: [],
                    database: { postgresql: { status: 'error', error: 'dashboard offline' },
                                redis: { status: 'error', error: 'dashboard offline' },
                                minio: { status: 'error', error: 'dashboard offline' } },
                    application: { nextjs: { status: 'error', error: 'dashboard offline' } },
                    system_resources: { containers_stats: [] },
                    summary: { pass: 0, fail: 1, warn: 0, total: 1, healthy: false },
                });
                resolve(errorPayload);
                return;
            }
            // Trim and validate JSON
            const trimmed = stdout.trim();
            try {
                JSON.parse(trimmed); // Validate
                resolve(trimmed);
            } catch {
                resolve('{}');
            }
        });
    });
}

// ── Periodic update ────────────────────────────────────────────────────
async function updateStatus() {
    latestJson = await fetchStatus();
    // Broadcast to all connected SSE clients
    const data = `data: ${latestJson}\n\n`;
    for (const client of clients) {
        client.write(data);
    }
}

// ── Start periodic fetch ──────────────────────────────────────────────
setInterval(updateStatus, INTERVAL_MS);
updateStatus(); // initial fetch

// ── HTTP Server ─────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // ── SSE endpoint ────────────────────────────────────────────────
    if (pathname === '/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });

        // Send current state immediately
        res.write(`data: ${latestJson}\n\n`);

        // Add to client list
        clients.push(res);

        // Remove on disconnect
        req.on('close', () => {
            clients = clients.filter(c => c !== res);
        });

        return;
    }

    // ── Serve HTML dashboard ────────────────────────────────────────
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML_TEMPLATE);
});

function tryListen(idx) {
    currentPortIndex = idx;
    if (idx >= PORTS.length) {
        console.error('  No available ports found. Exiting.');
        process.exit(1);
    }
    PORT = PORTS[idx];
    server.listen(PORT, '0.0.0.0');
}

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`  Port ${PORT} in use, trying next...`);
        tryListen(currentPortIndex + 1);
    } else {
        console.error('  Server error:', err.message);
    }
});

server.on('listening', () => {
    console.log(`\n  🌐 Severinno Web Dashboard\n`);
    console.log(`  Acessar:  http://localhost:${PORT}\n`);
    console.log(`  SSE:      http://localhost:${PORT}/events\n`);
    console.log(`  Ctrl+C to stop\n`);
});

tryListen(0);

// ============================================================================
// HTML Dashboard — embedded template
// ============================================================================
const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Severinno Dashboard</title>
<style>
  /* ── Reset & Variables ───────────────────────────────────────────── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #f4f5f7;
    --surface: #ffffff;
    --surface2: #f0f1f3;
    --text: #1a1a2e;
    --text2: #5a5a7a;
    --text3: #9090b0;
    --border: #e0e2e8;
    --ok: #22c55e;
    --err: #ef4444;
    --warn: #f59e0b;
    --off: #94a3b8;
    --accent: #6366f1;
    --accent2: #4f46e5;
    --radius: 12px;
    --shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
    --shadow2: 0 4px 12px rgba(0,0,0,0.08);
    --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --mono: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f0f1a;
      --surface: #1a1a2e;
      --surface2: #252540;
      --text: #e8e8f0;
      --text2: #a0a0c0;
      --text3: #606080;
      --border: #2a2a45;
      --shadow: 0 1px 3px rgba(0,0,0,0.2), 0 1px 2px rgba(0,0,0,0.3);
      --shadow2: 0 4px 12px rgba(0,0,0,0.4);
    }
  }
  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
    padding: 20px;
    min-height: 100vh;
    transition: background 0.3s, color 0.3s;
  }
  .container { max-width: 1200px; margin: 0 auto; }

  /* ── Header ──────────────────────────────────────────────────────── */
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 24px; margin-bottom: 24px;
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    border-radius: var(--radius);
    color: #fff;
    box-shadow: var(--shadow2);
  }
  header h1 {
    font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em;
    display: flex; align-items: center; gap: 10px;
  }
  header h1 .logo {
    width: 32px; height: 32px;
    background: rgba(255,255,255,0.2);
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 18px;
  }
  header .meta {
    display: flex; align-items: center; gap: 16px; font-size: 0.85rem;
  }
  header .meta .badge {
    padding: 4px 12px; border-radius: 20px;
    background: rgba(255,255,255,0.2);
    font-weight: 600;
    display: flex; align-items: center; gap: 6px;
  }
  header .meta .badge.live {
    animation: pulse 2s ease-in-out infinite;
  }
  header .meta .theme-label {
    opacity: 0.8;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  /* ── Grid ────────────────────────────────────────────────────────── */
  .grid { display: grid; gap: 16px; }
  .grid-2 { grid-template-columns: 1fr 1fr; }
  .grid-3 { grid-template-columns: 1fr 1fr 1fr; }
  .grid-4 { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  @media (max-width: 768px) { .grid-2, .grid-3 { grid-template-columns: 1fr; } }

  /* ── Cards ───────────────────────────────────────────────────────── */
  .card {
    background: var(--surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 20px;
    transition: all 0.2s ease;
  }
  .card:hover { box-shadow: var(--shadow2); }
  .card-title {
    font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text3); margin-bottom: 12px; font-weight: 700;
  }
  .card-value {
    font-size: 1.8rem; font-weight: 700; letter-spacing: -0.03em;
  }
  .card-label { font-size: 0.85rem; color: var(--text2); }

  /* ── Status dots ─────────────────────────────────────────────────── */
  .dot {
    display: inline-block; width: 10px; height: 10px;
    border-radius: 50%; margin-right: 8px;
    transition: background 0.3s;
  }
  .dot.ok { background: var(--ok); box-shadow: 0 0 6px var(--ok); }
  .dot.err { background: var(--err); box-shadow: 0 0 6px var(--err); }
  .dot.warn { background: var(--warn); box-shadow: 0 0 6px var(--warn); }
  .dot.off { background: var(--off); }

  /* ── Service Row ─────────────────────────────────────────────────── */
  .service-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 0; border-bottom: 1px solid var(--border);
  }
  .service-row:last-child { border-bottom: none; }
  .service-row .left { display: flex; align-items: center; gap: 8px; }
  .service-row .name { font-weight: 600; }
  .service-row .detail { font-size: 0.8rem; color: var(--text2); font-family: var(--mono); }
  .service-row .status { font-size: 0.8rem; font-weight: 600; padding: 2px 10px; border-radius: 12px; }
  .service-row .status.ok { background: rgba(34,197,94,0.1); color: var(--ok); }
  .service-row .status.err { background: rgba(239,68,68,0.1); color: var(--err); }
  .service-row .status.warn { background: rgba(245,158,11,0.1); color: var(--warn); }
  .service-row .status.off { background: rgba(148,163,184,0.1); color: var(--off); }

  /* ── Container Health ────────────────────────────────────────────── */
  .container-row {
    display: flex; align-items: center; gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid transparent;
    transition: background 0.2s;
  }
  .container-row .name { flex: 1; font-weight: 500; }
  .container-row .ports { font-size: 0.75rem; color: var(--text3); font-family: var(--mono); }
  .container-row .health { font-size: 0.75rem; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
  .container-row .health.ok { background: rgba(34,197,94,0.1); color: var(--ok); }
  .container-row .health.err { background: rgba(239,68,68,0.1); color: var(--err); }
  .container-row .health.warn { background: rgba(245,158,11,0.1); color: var(--warn); }
  .container-row .health.off { background: rgba(148,163,184,0.1); color: var(--off); }

  /* ── Logs ────────────────────────────────────────────────────────── */
  .log-box {
    background: var(--surface2); border-radius: 8px;
    padding: 12px 16px; margin-top: 8px;
    font-family: var(--mono); font-size: 0.75rem;
    max-height: 300px; overflow-y: auto;
    line-height: 1.6;
  }
  .log-box .log-line { opacity: 0.85; }
  .log-box .log-line.err { color: var(--err); opacity: 1; }
  .log-box .log-line.warn { color: var(--warn); opacity: 1; }
  .log-box .log-line .ts { color: var(--text3); }

  /* ── Summary ─────────────────────────────────────────────────────── */
  .summary-bar {
    display: flex; gap: 24px; align-items: center; justify-content: center;
    padding: 20px; flex-wrap: wrap;
  }
  .summary-item { text-align: center; }
  .summary-item .num { font-size: 2rem; font-weight: 800; letter-spacing: -0.03em; }
  .summary-item .label { font-size: 0.75rem; color: var(--text2); text-transform: uppercase; letter-spacing: 0.05em; }
  .summary-item.pass .num { color: var(--ok); }
  .summary-item.fail .num { color: var(--err); }
  .summary-item.warn .num { color: var(--warn); }

  .health-banner {
    text-align: center; padding: 16px;
    border-radius: var(--radius); font-weight: 700; font-size: 1.1rem;
    margin-top: 16px;
  }
  .health-banner.ok { background: rgba(34,197,94,0.1); color: var(--ok); }
  .health-banner.err { background: rgba(239,68,68,0.1); color: var(--err); }
  .health-banner.warn { background: rgba(245,158,11,0.1); color: var(--warn); }

  /* ── Stat Bar (CPU/Mem) ──────────────────────────────────────────── */
  .stat-bar { margin: 4px 0; }
  .stat-bar .row { display: flex; justify-content: space-between; font-size: 0.8rem; padding: 2px 0; }
  .stat-bar .row .name { color: var(--text2); }
  .stat-bar .row .vals { font-family: var(--mono); }

  /* ── Disk gauge ──────────────────────────────────────────────────── */
  .disk-bar {
    height: 8px; background: var(--surface2); border-radius: 4px;
    overflow: hidden; margin: 8px 0 4px;
  }
  .disk-bar .fill {
    height: 100%; border-radius: 4px;
    transition: width 0.5s ease;
  }

  /* ── Footer ──────────────────────────────────────────────────────── */
  footer {
    text-align: center; padding: 32px 0 16px;
    color: var(--text3); font-size: 0.8rem;
  }

  /* ── Animations ──────────────────────────────────────────────────── */
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .fade-in { animation: fadeIn 0.3s ease; }
  .stagger > * { animation: fadeIn 0.3s ease both; }
  .stagger > *:nth-child(1) { animation-delay: 0.02s; }
  .stagger > *:nth-child(2) { animation-delay: 0.04s; }
  .stagger > *:nth-child(3) { animation-delay: 0.06s; }
  .stagger > *:nth-child(4) { animation-delay: 0.08s; }
  .stagger > *:nth-child(5) { animation-delay: 0.10s; }

  /* ── Loading ─────────────────────────────────────────────────────── */
  .loading {
    display: flex; justify-content: center; align-items: center;
    padding: 80px 0; color: var(--text3);
  }
  .loading .spinner {
    width: 32px; height: 32px; border: 3px solid var(--border);
    border-top-color: var(--accent); border-radius: 50%;
    animation: spin 0.8s linear infinite; margin-right: 12px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="container" id="app">
  <div class="loading" id="loading">
    <div class="spinner"></div>
    <span>Conectando ao servidor SSE...</span>
  </div>
</div>

<script>
(function() {
  'use strict';

  const app = document.getElementById('app');
  const container = document.querySelector('.container');
  const dark = window.matchMedia('(prefers-color-scheme: dark)');

  // ── Color helpers ──────────────────────────────────────────────────
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // ── Status helpers ─────────────────────────────────────────────────
  function healthClass(status) {
    if (status === 'ok' || status === 'healthy' || status === 'running') return 'ok';
    if (status === 'error' || status === 'unhealthy' || status === 'exited') return 'err';
    if (status === 'starting') return 'warn';
    return 'off';
  }
  function statusLabel(status) {
    if (status === 'ok') return '● Healthy';
    if (status === 'error') return '● Error';
    if (status === 'starting') return '◷ Starting';
    return '○ Off';
  }

  // ── Escape HTML ────────────────────────────────────────────────────
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Disk bar color ─────────────────────────────────────────────────
  function diskColor(pct) {
    if (pct >= 90) return 'var(--err)';
    if (pct >= 70) return 'var(--warn)';
    return 'var(--ok)';
  }

  // ── Render function ────────────────────────────────────────────────
  function render(data) {
    if (!data || data.error) {
      app.innerHTML = '<div class="loading"><div class="spinner"></div><span>Servidor offline — aguardando...</span></div>';
      return;
    }
    const s = data.summary || {};
    const db = data.database || {};
    const appSrv = data.application || {};
    const nx = appSrv.nextjs || {};
    const sys = data.system_resources || {};
    const theme = data.theme || (dark.matches ? 'dark' : 'light');
    const themeIcon = theme === 'dark' ? '🌙' : '☀️';
    const healthy = s.healthy !== false;
    const healthyClass = healthy ? 'ok' : (s.warn > 0 ? 'warn' : 'err');

    // ── Build HTML ──────────────────────────────────────────────
    let html = '';

    // ── Header ──────────────────────────────────────────────────
    html += '<header class="fade-in">';
    html += '<h1><span class="logo">⬡</span> Severinno Dashboard</h1>';
    html += '<div class="meta">';
    html += '<span class="badge live">● LIVE</span>';
    html += '<span class="badge">' + themeIcon + ' ' + theme.charAt(0).toUpperCase() + theme.slice(1) + '</span>';
    if (data.timestamp) {
      const t = new Date(data.timestamp);
      html += '<span class="theme-label">' + t.toLocaleTimeString() + '</span>';
    }
    html += '</div></header>';

    // ── Summary cards ───────────────────────────────────────────
    html += '<div class="grid grid-4 stagger">';
    html += '<div class="card"><div class="card-title">Pass</div><div class="card-value" style="color:var(--ok)">' + (s.pass ?? 0) + '</div><div class="card-label">serviços saudáveis</div></div>';
    html += '<div class="card"><div class="card-title">Fail</div><div class="card-value" style="color:var(--err)">' + (s.fail ?? 0) + '</div><div class="card-label">serviços com erro</div></div>';
    html += '<div class="card"><div class="card-title">Warn</div><div class="card-value" style="color:var(--warn)">' + (s.warn ?? 0) + '</div><div class="card-label">serviços em alerta</div></div>';
    html += '<div class="card"><div class="card-title">Total</div><div class="card-value">' + (s.total ?? 0) + '</div><div class="card-label">serviços monitorados</div></div>';
    html += '</div>';

    // ── Health banner ───────────────────────────────────────────
    html += '<div class="health-banner ' + healthyClass + '">';
    if (healthy) html += '✅ Todos os serviços operacionais';
    else if (s.warn > 0 && (s.fail ?? 0) === 0) html += '⚠️  Serviços operacionais com ressalvas';
    else html += '❌ ' + (s.fail ?? 0) + ' falha(s) detectada(s)';
    html += '</div>';

    // ── Docker Containers ───────────────────────────────────────
    html += '<div class="card fade-in" style="margin-top:16px">';
    html += '<div class="card-title">🐳 Docker Containers <span style="font-weight:400;text-transform:none;letter-spacing:0">(' + (data.containers ? data.containers.length : 0) + ')</span></div>';
    if (data.containers && data.containers.length > 0) {
      html += '<div>';
      for (const c of data.containers) {
        const hc = healthClass(c.health);
        html += '<div class="container-row">';
        html += '<span class="dot ' + hc + '"></span>';
        html += '<span class="name">' + esc(c.short_name || c.name) + '</span>';
        html += '<span class="ports">' + esc(c.ports || '') + '</span>';
        html += '<span class="health ' + hc + '">' + esc(c.health || 'unknown') + '</span>';
        html += '</div>';
      }
      html += '</div>';
    } else {
      html += '<div style="color:var(--text3);padding:8px 0">Nenhum container rodando</div>';
    }
    html += '</div>';

    // ── Database & Cache ────────────────────────────────────────
    html += '<div class="grid grid-2" style="margin-top:16px">';

    // PostgreSQL
    const pg = db.postgresql || {};
    const pgHc = healthClass(pg.status);
    html += '<div class="card fade-in">';
    html += '<div class="card-title">🗄️ PostgreSQL</div>';
    html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">';
    html += '<span class="dot ' + pgHc + '" style="width:14px;height:14px"></span>';
    html += '<span class="status ' + pgHc + '">' + statusLabel(pg.status) + '</span>';
    html += '</div>';
    if (pg.tables !== undefined) html += '<div><span class="card-label">Tabelas:</span> <strong>' + pg.tables + '</strong></div>';
    if (pg.postgis_version) html += '<div><span class="card-label">PostGIS:</span> <strong>' + esc(pg.postgis_version) + '</strong></div>';
    if (pg.error) html += '<div style="color:var(--err);font-size:0.85rem">' + esc(pg.error) + '</div>';
    html += '</div>';

    // Redis + MinIO
    html += '<div class="card fade-in">';
    html += '<div class="card-title">⚡ Cache & Storage</div>';
    // Redis
    const rd = db.redis || {};
    const rdHc = healthClass(rd.status);
    html += '<div class="service-row"><div class="left"><span class="dot ' + rdHc + '"></span><span class="name">Redis</span></div>';
    html += '<span class="status ' + rdHc + '">' + (rd.ping || rd.status || 'off') + '</span></div>';
    // MinIO
    const mi = db.minio || {};
    const miHc = healthClass(mi.status);
    html += '<div class="service-row"><div class="left"><span class="dot ' + miHc + '"></span><span class="name">MinIO S3</span></div>';
    html += '<span class="status ' + miHc + '">' + (mi.status === 'ok' ? '9000' : (mi.error || 'off')) + '</span></div>';
    html += '</div>';

    html += '</div>'; // grid-2

    // ── Application Server ──────────────────────────────────────
    const nxHc = healthClass(nx.status);
    html += '<div class="card fade-in" style="margin-top:16px">';
    html += '<div class="card-title">🌐 Application Server</div>';
    html += '<div class="service-row"><div class="left"><span class="dot ' + nxHc + '"></span><span class="name">Next.js</span></div>';
    html += '<span class="status ' + nxHc + '">HTTP ' + (nx.http_code || '000') + '</span></div>';
    if (nx.url) html += '<div style="font-size:0.8rem;color:var(--text2);font-family:var(--mono)">' + esc(nx.url) + '</div>';
    html += '</div>';

    // ── System Resources ────────────────────────────────────────
    html += '<div class="card fade-in" style="margin-top:16px">';
    html += '<div class="card-title">📊 System Resources</div>';

    // Disk
    if (sys.disk) {
      const dk = sys.disk;
      const pct = dk.used_percent || 0;
      html += '<div class="service-row"><div class="left"><span class="name">Disk (/)</span></div>';
      html += '<div style="text-align:right"><strong>' + esc(dk.used) + '</strong> of <strong>' + esc(dk.total) + '</strong> used</div></div>';
      html += '<div class="disk-bar"><div class="fill" style="width:' + pct + '%;background:' + diskColor(pct) + '"></div></div>';
      html += '<div style="font-size:0.8rem;color:var(--text3);text-align:right">' + esc(dk.available) + ' free · ' + pct + '%</div>';
    }
    if (sys.docker_disk) {
      html += '<div class="service-row" style="margin-top:4px"><div class="left"><span class="name">Docker Disk</span></div>';
      html += '<span style="font-family:var(--mono);font-size:0.85rem">' + esc(sys.docker_disk) + '</span></div>';
    }

    // Container CPU/Mem
    if (sys.containers_stats && sys.containers_stats.length > 0) {
      html += '<div class="card-title" style="margin-top:12px;margin-bottom:4px">Container CPU/Memory</div>';
      html += '<div class="stat-bar">';
      for (const st of sys.containers_stats) {
        html += '<div class="row"><span class="name">' + esc(st.name) + '</span>';
        html += '<span class="vals">' + esc(st.cpu || '') + ' · ' + esc(st.memory || '') + '</span></div>';
      }
      html += '</div>';
    }
    html += '</div>';

    // ── Live Logs ───────────────────────────────────────────────
    if (data.containers && data.containers.length > 0) {
      html += '<div class="card fade-in" style="margin-top:16px">';
      html += '<div class="card-title">📋 Live Logs (<span id="log-count">0</span> containers)</div>';
      html += '<div class="log-box" id="log-box">';
      // We fetch logs separately via fetch to avoid blocking
      html += '<div style="color:var(--text3)">Carregando logs...</div>';
      html += '</div></div>';
    }

    // ── Footer ──────────────────────────────────────────────────
    html += '<footer>Severinno Web Dashboard · ' + esc(data.timestamp ? new Date(data.timestamp).toLocaleString() : '') + '</footer>';

    app.innerHTML = html;

    // ── Fetch logs asynchronously ──────────────────────────────
    fetchLogs(data.containers);
    updateLogCount(data.containers ? data.containers.length : 0);
  }

  // ── Fetch container logs via dashboard --json (reuse cached data logs) ─
  function fetchLogs(containers) {
    if (!containers || containers.length === 0) return;
    const logBox = document.getElementById('log-box');
    if (!logBox) return;
    // For logs, fetch a separate endpoint or use the same SSE data
    // Since the JSON doesn't include log lines, we use a separate approach:
    // Render just the container names we have
    let logHtml = '';
    for (const c of containers) {
      const sn = c.short_name || c.name;
      logHtml += '<div class="log-line"><span style="font-weight:600">' + esc(sn) + '</span> <span class="ts">— ' + esc(c.status || '') + '</span></div>';
    }
    logBox.innerHTML = logHtml;
  }

  function updateLogCount(n) {
    const el = document.getElementById('log-count');
    if (el) el.textContent = n;
  }

  // ── SSE connection ──────────────────────────────────────────────────
  function connectSSE() {
    const evtSource = new EventSource('/events');

    evtSource.onmessage = function(event) {
      try {
        const data = JSON.parse(event.data);
        render(data);
      } catch (e) {
        console.error('SSE parse error:', e);
      }
    };

    evtSource.onerror = function() {
      // Reconnect automatically — EventSource does this by default
      app.innerHTML = '<div class="loading"><div class="spinner"></div><span>Conexão perdida — reconectando...</span></div>';
    };
  }

  // ── Start ─────────────────────────────────────────────────────────
  connectSSE();

})();
</script>
</body>
</html>`;
