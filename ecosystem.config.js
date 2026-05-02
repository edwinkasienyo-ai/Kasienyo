// PM2 ecosystem file. Start with: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "imis",
      script: "src/server.js",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 5002,
        FORCE_HTTPS: "true",
        ENABLE_CSP: "true"
      },
      env_development: {
        NODE_ENV: "development",
        PORT: 5002
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      out_file: "./logs/imis.out.log",
      error_file: "./logs/imis.err.log",
      max_restarts: 10,
      kill_timeout: 8000
    }
  ]
};
