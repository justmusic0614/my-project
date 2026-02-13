module.exports = {
  apps: [{
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
  }]
};
