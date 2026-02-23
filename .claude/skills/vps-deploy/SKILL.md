---
name: vps-deploy
description: |
  VPS 部署和操作指南。當任務涉及 VPS、cron、SSH、部署、同步時使用。
  包含環境差異、SSH 安全規則、風險分級。
tools: Read, Bash, Grep, Glob
disable-model-invocation: true
---

## VPS/Cron 操作強制檢查

當任務涉及 VPS 或 cron 環境時：

1. 查閱 [references/environments.md](references/environments.md) 的已知差異
2. 確認目標環境（local / VPS / cron）
3. 特別注意：shell 變數、RAM 限制、dotenv 行為、XDG_RUNTIME_DIR

## SSH 安全規則

1. **指令逐一發送** — 不可並行多個 SSH session（會觸發 OOM）
2. **避開 cron 高峰期** — 每 5 分鐘整點（:00, :05, :10...）cron 任務執行中
3. **大量文字** — 不用 heredoc，用 base64 編碼後單行傳輸
4. **教訓來源** — 2026-02-20 OOM 事件（VPS 卡死需重啟）

## SSH 操作風險分級

### 低風險（自動執行）
- 查看狀態：`top`, `free -m`, `df -h`, `pm2 status`, `systemctl --user status`
- 查看日誌：`tail logs/`, `cat data/runtime/`
- 檢查配置：`cat config.json`

### 中風險（告知用戶後執行）
- 部署新程式碼：`git pull`, `npm install`
- 同步檔案：`rsync`, `scp`
- 修改配置：`nano config.json`, `nano .env`

### 高風險（必須用戶確認才執行）
- 重啟服務：`pm2 restart`, `systemctl --user restart`
- 刪除檔案：`rm`, `rmdir`
- 修改 crontab：`crontab -e`
- 大量寫入：base64 傳輸大檔案
- 觸及多個服務：批量操作

## 部署流程

1. 本地開發 → `git commit` → `git push origin main`
2. 執行 `./scripts/sync-to-vps.sh` 同步到 VPS
3. 如修改了 server 程式碼，重啟服務
4. 驗證：健康檢查 + 日誌確認

## 參考資料

- [references/environments.md](references/environments.md) — Local / VPS / cron 三種環境差異表
