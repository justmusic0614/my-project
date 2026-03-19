# Issue 分類法

Dogfood 過程中發現的 issue 按此分類。每個 issue 必須指定一個類別和一個嚴重度。

## 嚴重度

| 等級 | 定義 | 判斷標準 |
| --- | --- | --- |
| **P0-Critical** | 功能完全不可用 | agent.js 無法啟動、config.json parse 失敗、CLI crash |
| **P1-High** | 核心功能受損 | 主要命令報錯但不 crash、資料遺失、輸出錯誤 |
| **P2-Medium** | 非核心問題 | 可選功能故障、輸出格式異常、DX 不佳 |
| **P3-Low** | 美化/建議 | 文件過時、命名不一致、可改善項 |

## 類別

### CLI — CLI 命令問題

- exit code 與實際結果不一致（成功卻回傳非 0、失敗卻回傳 0）
- help 文字過時或不完整
- 未知指令沒有提示或直接 crash
- 無參數時沒有顯示使用說明
- 指令輸出格式不一致

### CFG — 配置問題

- config.json 缺少必要欄位（name, version, paths）
- `${VAR}` 佔位符沒有對應的環境變數
- 路徑硬編碼（應該是相對路徑或可配置）
- config schema 不符合 agent-template 基準
- .env 中的值格式錯誤

### STR — 結構合規

- 缺少必要檔案（agent.js、config.json、README.md）
- 缺少必要目錄（src/、data/runtime/）
- 殘留 test-*.js/sh 檔案（應在測試後清除）
- 殘留 *_COMPLETE.md / *_REPORT.md（應在歸檔後清除）
- 不符合 agent-template 結構規範

### ERR — 錯誤處理

- 未捕獲的 exception（unhandled rejection、uncaught error）
- 錯誤訊息不明確（只有 "Error" 沒有上下文）
- 缺少 graceful degradation（一個失敗就全掛）
- 缺少輸入驗證（接受了明顯無效的輸入）

### SRE — 運維健壯性

- health-check 未實作或未註冊
- cron-wrapper.sh 缺少必要 preamble（NVM_DIR、PATH、API keys）
- cron-wrapper.sh 缺少 execute 權限
- 日誌無 rotation 或無大小限制
- PM2 / systemd 配置缺失或過時

### DX — 開發者體驗

- README.md 內容過時或與實際不符
- 指令風格不一致（有的用 `run` 有的用 `/run`）
- 缺少 `--help` 或 help 輸出不清楚
- 錯誤訊息缺少建議修復方式
- 缺少使用範例

### SEC — 安全

- 硬編碼 API key / token / secret
- .env 檔案被意外 commit
- 使用 `execSync` 或 `exec` 時未過濾輸入
- 敏感資訊出現在 stdout/log 中
