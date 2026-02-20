# CLAUDE.md - my-project

> **文件版本**: 1.0
> **最後更新**: 2026-02-06
> **專案**: my-project
> **描述**: CLI 工具
> **功能**: GitHub 自動備份、Task agents、技術債防範

本檔案提供 Claude Code (claude.ai/code) 在此專案中工作時的重要指引。

## 關鍵規則 - 請先閱讀

### 絕對禁止事項
- **絕不** 在根目錄建立新檔案 - 使用適當的模組結構
- **絕不** 直接在根目錄寫入輸出檔案 - 使用指定的輸出資料夾
- **絕不** 建立文件檔案 (.md) 除非使用者明確要求
- **絕不** 使用帶有 -i 旗標的 git 命令（不支援互動模式）
- **絕不** 使用 `find`, `grep`, `cat`, `head`, `tail`, `ls` 命令 - 改用 Read, Grep, Glob 工具
- **絕不** 建立重複檔案（manager_v2.js, enhanced_xyz.js, utils_new.js）- 永遠擴展現有檔案
- **絕不** 對同一概念建立多個實作 - 單一真實來源
- **絕不** 複製貼上程式碼區塊 - 提取到共用工具/函式
- **絕不** 硬編碼應該可配置的數值 - 使用配置檔案/環境變數
- **絕不** 使用 enhanced_、improved_、new_、v2_ 等命名 - 改為擴展原始檔案

### 強制要求
- **提交 (COMMIT)** 每個完成的任務/階段後 - 沒有例外
- **GITHUB 備份** - 每次提交後推送到 GitHub: `git push origin main`
- **使用 TASK AGENTS** 處理所有長時間運行的操作（>30 秒）
- **先讀取檔案** 再編輯 - 如果沒有先讀取檔案，Edit/Write 工具會失敗
- **債務預防** - 在建立新檔案前，檢查是否有現有的類似功能可以擴展
- **單一真實來源** - 每個功能/概念只有一個權威實作

### 執行模式
- **平行 TASK AGENTS** - 同時啟動多個 Task agents 以達到最高效率
- **GITHUB 備份工作流程** - 每次提交後: `git push origin main`
- **背景處理** - 只有 Task agents 可以執行真正的背景操作

### 強制性任務前合規檢查

開始任何任務前，請驗證：
- [ ] 這會在根目錄建立檔案嗎？如果是，改用適當的模組結構
- [ ] 這會花費超過 30 秒嗎？如果是，使用 Task agents 而非 Bash
- [ ] 類似功能已經存在嗎？如果是，擴展現有程式碼
- [ ] 我正在建立重複的類別/管理器嗎？如果是，改為整合
- [ ] 我已經搜尋過現有實作了嗎？先使用 Grep/Glob 工具
- [ ] 我可以擴展現有程式碼而非建立新的嗎？優先選擇擴展而非建立

## 專案概覽

**my-project** 是一個使用 JavaScript 建構的 CLI 工具。

### 專案結構
```
src/main/js/          # 主要 JavaScript 原始碼
  core/               # 核心業務邏輯
  utils/              # 工具函式
  models/             # 資料模型
  services/           # 服務層
  api/                # API 介面
src/main/resources/   # 配置和資源
src/test/             # 單元測試和整合測試
docs/                 # 文件
tools/                # 開發工具
output/               # 生成的輸出檔案
```

### 開發狀態
- **設置**: 完成
- **核心功能**: 未開始
- **測試**: 未開始
- **文件**: 未開始

## Agent 標準化結構

新建 agent 必須遵循 `src/shared/agent-template/` 模板結構：

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

### 生命週期規則
- 測試腳本（test-*.js/sh）：開發完即刪除，生產監控進 sre/
- Patch 腳本（patch-*.js）：執行完即刪除
- Backup 檔案（*.backup）：不進 git
- 開發報告（*_COMPLETE.md）：不建立，更新 README.md

### 適用範圍
- 新 agent：必須遵循
- market-digest：維持 backend/，不遷移

## 技術債預防

### 正確做法:
```bash
# 1. 先搜尋
Grep(pattern="feature.*implementation", include="*.js")
# 2. 讀取現有檔案
Read(file_path="existing_feature.js")
# 3. 擴展現有功能
Edit(file_path="existing_feature.js", old_string="...", new_string="...")
```

## 常用命令

```bash
# 執行 CLI 工具
node src/main/js/index.js

# 執行測試
npm test

# 檢查 git 狀態
git status

# 推送到 GitHub
git push origin main
```
