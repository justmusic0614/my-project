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
        HOST: '127.0.0.1',
        KANBAN_ENV: 'vps'
      },
      max_memory_restart: '256M',       // 150M → 256M，緩解高峰期 OOM
      autorestart: true,
      max_restarts: 5,                  // 降低上限防快速循環（預設 15）
      restart_delay: 5000,              // 每次重啟等 5s，給 CPU 恢復空間
      exp_backoff_restart_delay: 100,   // 指數退避，越重啟等越久
      min_uptime: '30s',                // 30s 內崩潰才算失敗次數
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
