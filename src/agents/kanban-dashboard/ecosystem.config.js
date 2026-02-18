module.exports = {
  apps: [
    // Kanban Dashboard Server
    {
      name: 'kanban-dashboard',
      script: 'server/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        KANBAN_ENV: 'vps'
      },
      max_memory_restart: '150M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'data/logs/error.log',
      out_file: 'data/logs/out.log',
      merge_logs: true
    },

    // Telegram Long Polling（取代 Cloudflare Tunnel + Webhook）
    {
      name: 'telegram-poller',
      script: 'scripts/telegram-poller.js',
      cwd: __dirname,

      // 重啟策略
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s',

      // 資源限制（比 cloudflared 更輕量）
      max_memory_restart: '80M',

      // 日誌配置
      error_file: 'data/logs/poller-error.log',
      out_file: 'data/logs/poller-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};
