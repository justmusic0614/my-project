---
name: agent-scaffold
description: |
  建立新 agent 的標準化結構。遵循 src/shared/agent-template/ 模板。
  確保新 agent 符合專案規範，避免結構不一致。
tools: Read, Write, Bash, Glob
disable-model-invocation: true
---

## Agent 標準化結構

新建 agent 必須遵循 `src/shared/agent-template/` 模板。

### 強制檔案

- `agent.js` — 唯一入口點
- `config.json` — 運行時配置
- `README.md` — 唯一說明文件（禁止 *_COMPLETE.md、*_REPORT.md）

### 強制目錄

- `src/` — 核心業務邏輯
- `data/runtime/` — 短暫狀態

### 選用目錄

- `sre/` — health-check、circuit-breaker、cron-wrapper
- `logs/` — 執行日誌
- `references/` — 靜態參考資料
- `deprecated/` — 廢棄代碼暫存（定期清理）

## 生命週期規則

- 測試腳本（test-*.js/sh）：開發完即刪除，生產監控進 `sre/`
- Patch 腳本（patch-*.js）：執行完即刪除
- Backup 檔案（*.backup）：不進 git
- 開發報告（*_COMPLETE.md）：不建立，更新 `README.md`

## 建立步驟

1. 確認 agent 名稱和用途
2. 複製 `src/shared/agent-template/` 結構
3. 實作 `agent.js` 入口點
4. 設定 `config.json`
5. 撰寫 `README.md`
6. 如需 SRE 監控，建立 `sre/` 目錄

## 適用範圍

- **新 agent** — 必須遵循
- **market-digest** — 維持 `backend/`，不遷移（歷史例外）
