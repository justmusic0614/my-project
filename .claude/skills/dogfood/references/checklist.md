# 探索 Checklist

系統性測試 CLI 和所有 agents 的完整檢查清單。按 A-G 區塊順序執行。

> 每項測試後記錄：指令、預期結果、實際結果、exit code。
> 發現問題立即填入報告，不要延後。

## A. CLI 主進入點

測試 `node src/main/js/index.js`：

- [ ] `node src/main/js/index.js` — 無參數時顯示使用說明
- [ ] `node src/main/js/index.js hello` — 基本功能正常
- [ ] `node src/main/js/index.js unknown-cmd` — 未知指令有友善提示
- [ ] 每個已知指令（hello, backup, digest）的 exit code 正確
- [ ] `--help` flag 是否支援

## B. Agent 結構合規

對每個 agent（`ls src/agents/`）檢查：

- [ ] `agent.js` 存在
- [ ] `config.json` 存在且是合法 JSON
- [ ] `config.json` 包含必要欄位：name, version, paths
- [ ] `config.json` 的 paths.src 和 paths.runtime 指向的目錄存在
- [ ] `src/` 目錄存在（market-digest 例外：用 `backend/`）
- [ ] `data/runtime/` 目錄存在
- [ ] `README.md` 存在且非空
- [ ] 無殘留 `test-*.js` 或 `test-*.sh` 檔案
- [ ] 無殘留 `*_COMPLETE.md` 或 `*_REPORT.md` 檔案

## C. Agent 指令測試

對有 `agent.js` 的 agent 執行：

- [ ] `node agent.js help` — 顯示使用說明
- [ ] `node agent.js status` — 顯示狀態（若支援）
- [ ] `node agent.js unknown` — 未知指令有提示
- [ ] `node agent.js` — 無參數時的行為合理
- [ ] 每個指令的 exit code 正確

## D. Config 驗證

- [ ] `config.json` 中的 `${VAR}` 佔位符都有對應的環境變數定義
- [ ] telegram 設定中的 chatId 和 botToken 使用環境變數（非硬編碼）
- [ ] sre.healthCheck 和 sre.circuitBreaker 設定合理
- [ ] logging.level 是有效值（info, warn, error, debug）
- [ ] config schema 與 `src/shared/agent-template/config.json` 一致

## E. SRE 設施

對有 `sre/` 目錄的 agent 檢查：

- [ ] `sre/health-check.js` 存在且可 `require`（不 crash）
- [ ] `sre/cron-wrapper.sh` 存在且有 execute 權限（`-x`）
- [ ] `sre/cron-wrapper.sh` 包含必要 preamble：
  - `export NVM_DIR` + `source nvm.sh`
  - `export PATH="$HOME/.local/bin:$PATH"`
  - API key 載入
- [ ] crontab.example 存在且語法正確

## F. 錯誤處理

選擇 2-3 個代表性 agent 深入測試：

- [ ] 缺少 config.json 時的行為（暫時重命名 → 測試 → 還原）
- [ ] config.json 為無效 JSON 時的行為
- [ ] 缺少必要環境變數時的行為
- [ ] 空的 data/runtime/ 目錄時的行為

> ⚠️ 測試破壞性場景時，務必在測試後還原原始狀態。

## G. 跨 Agent 一致性

橫向比較所有 agents：

- [ ] 指令風格統一（run / start / execute 是否一致）
- [ ] help 輸出格式統一（都有指令清單 + 簡要說明）
- [ ] 錯誤訊息格式統一（建議：`[agent-name] Error: description`）
- [ ] config.json schema 統一（都遵循 agent-template 基準）
- [ ] README.md 格式統一（都有功能、使用方式、資料目錄段落）

## VPS 額外檢查（`--vps` 時）

透過 vps-operator subagent 執行：

- [ ] `pm2 list` — 所有預期 process 都在運行
- [ ] `systemctl --user status openclaw-gateway` — 服務正常
- [ ] `crontab -l` — cron 任務完整且無過時條目
- [ ] `df -h` — 磁碟使用量 < 80%
- [ ] `free -h` — 記憶體使用量合理
- [ ] agents 的 runtime 目錄存在且有最近產出
- [ ] agents 的日誌檔案大小合理（無暴漲）
