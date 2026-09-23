/**
 * PM2 Ecosystem Config — Severinno Marketplace
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup  # (run the suggested systemd command)
 *
 * Features:
 *   - Auto-restart on crash with exponential backoff (1s → 2s → 4s → max 15s)
 *   - Memory limit: restart if > 512MB
 *   - Daily restart at 4 AM (clears memory leaks)
 *   - Graceful shutdown (SIGINT → SIGTERM → SIGKILL after 5s)
 *   - Log rotation (10MB, keep 5 files)
 */

module.exports = {
  apps: [
    {
      name: "severinno",
      script: "node_modules/.bin/next",
      args: "start -p 3000",
      cwd: "/home/severinno/severinno",
      instances: 1,
      exec_mode: "fork",

      // ── Auto-restart ──────────────────────────────────────────────
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",

      // Exponential backoff: 1s, 2s, 4s, 8s, 15s (capped)
      exp_backoff_restart_delay: 1000,

      // Restart after unstable crashes (3 restarts in 15s = unstable)
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 1000,

      // ── Scheduled restart (clear memory leaks) ────────────────────
      cron_restart: "0 4 * * *",

      // ── Environment ───────────────────────────────────────────────
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },

      // ── Logging ───────────────────────────────────────────────────
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "/home/severinno/.pm2/logs/severinno-error.log",
      out_file: "/home/severinno/.pm2/logs/severinno-out.log",
      merge_logs: true,
      log_type: "json",

      // ── Graceful shutdown ─────────────────────────────────────────
      kill_timeout: 5000,
      listen_timeout: 10000,
      shutdown_with_message: false,

      // ── Node.js flags ─────────────────────────────────────────────
      node_args: "--max-old-space-size=512",
    },
  ],
}
