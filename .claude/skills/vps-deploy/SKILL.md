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
2. 執行 `./tools/deploy.sh <agent>` 同步並部署
   - 流程：audit（偵測 VPS 未同步修改）→ rsync → PM2 重啟
   - 支援 `--dry-run`、`--skip-audit`、`--skip-restart`
   - 可用 agents：`kanban-dashboard`, `market-digest`, `security-patrol`, `knowledge-digest`, `deploy-monitor`, `shared`, `all`
3. 驗證：健康檢查 + 日誌確認

## VPS 同步後驗證步驟

每次 `git show origin/main:src/... > agents/...` 同步後，必須：

1. **模組 load 驗證**：
   ```bash
   node -e "require('./agents/market-digest/backend/llm-client')"
   # 無錯誤才繼續
   ```
2. **欄位對齊確認**：caller 使用的欄位名（如 `.text`）和 callee 回傳欄位名（如 `.content`）是否一致
3. **env var 確認**：`printenv | grep -E "OPENAI|FMP|SENDGRID"` 確認已 export
4. **smoke test**：`node agents/[agent]/agent.js --dry-run 2>&1 | tail -20`

## 參考資料

- [references/environments.md](references/environments.md) — Local / VPS / cron 三種環境差異表
