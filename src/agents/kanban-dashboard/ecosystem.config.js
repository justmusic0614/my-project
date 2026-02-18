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

    // Cloudflare Tunnel
    {
      name: 'cloudflare-tunnel',
      script: 'scripts/start-tunnel.sh',
      interpreter: '/bin/bash',
      cwd: __dirname,

      // 重啟策略
      autorestart: true,
      restart_delay: 5000,        // 重啟前等待 5 秒
      max_restarts: 10,            // 1 分鐘內最多重啟 10 次
      min_uptime: '10s',           // 運行少於 10 秒視為異常重啟

      // 資源限制
      max_memory_restart: '100M',  // cloudflared 通常使用 30-50MB

      // 日誌配置
      error_file: 'logs/tunnel-error.log',
      out_file: 'logs/tunnel-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // 環境變數由 VPS 的 .env 提供，不在此硬編碼
    }
  ]
};
