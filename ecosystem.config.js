/**
 * PM2 Ecosystem Config — Severinno
 *
 * Usage:
 *   npx pm2 start ecosystem.config.js
 *   npx pm2 status
 *   npx pm2 logs severinno
 *   npx pm2 stop severinno
 *   npx pm2 delete severinno
 */

module.exports = {
  apps: [
    {
      name: "severinno",
      script: "node_modules/.bin/next",
      args: "start -p 3000",
      cwd: __dirname,
      instances: 1, // Single instance (Next.js handles its own clustering)
      exec_mode: "fork",

      // Environment
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },

      // Restart policy
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",

      // Logging
      error_file: "/tmp/severinno-error.log",
      out_file: "/tmp/severinno-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,

      // Performance
      node_args: "--max-old-space-size=1024",
    },
  ],
}
