# 重構變更日誌

> 建立日期：2026-02-24

## 重構目標

將散落在多個檔案中的 Claude Code 配置內容，依照官方 plugin 規範拆分歸位到正確的載體，實現按需載入、去重、可維護。

## 執行紀錄

### Step 0: 備份

- `git tag pre-refactor` — 標記重構前狀態
- 建立 `_backup_before_refactor/`，複製 3 個 memory 檔案（MEMORY.md、effective-prompts.md、environments.md）

### Step 1: 基礎設施

- 建立目錄：`.claude/skills/`、`.claude/agents/`、`docs/refactor/`、`docs/references/`
- `.gitignore` 加入 `CLAUDE.local.md` 和 `_backup_before_refactor/`
- 建立 `.claude/settings.json`（26 條 wildcard 權限 + SessionStart hook）
- 建立 `CLAUDE.local.md`（VPS 快速參考 + 11 條 Key Learnings + FMP API 注意事項）

### Step 2: 建立 4 個 Skills

- `.claude/skills/task-planning/SKILL.md` — Claude-only 背景知識（任務前 checklist、合規檢查、配置修改規則）
- `.claude/skills/task-planning/references/task-templates.md` — 6 種任務類型模板（從 effective-prompts.md Layer 2）
- `.claude/skills/task-planning/references/pipeline-model.md` — Pipeline 依賴模型（從 CLAUDE.md + effective-prompts.md Layer 3）
- `.claude/skills/vps-deploy/SKILL.md` — 使用者 `/vps-deploy`（VPS 操作檢查、SSH 安全規則、風險分級）
- `.claude/skills/vps-deploy/references/environments.md` — 環境差異表（從 memory/environments.md）
- `.claude/skills/bug-fix/SKILL.md` — 雙向觸發（Bug 修復 4 步流程、反模式警示）
- `.claude/skills/agent-scaffold/SKILL.md` — 使用者 `/agent-scaffold`（Agent 標準化結構、生命週期規則）

### Step 3: 建立 vps-operator subagent

- `.claude/agents/vps-operator.md` — VPS 操作專家（Sonnet 模型、Bash+Read 工具、SSH 安全規則內建）

### Step 4: 重寫 CLAUDE.md

- 170 行 → ~60 行
- 保留：6 條禁止規則、4 條強制要求、專案結構、Agent 結構摘要、.claude/ 結構表、常用命令
- 移除：3 條工具已強制的禁止規則、執行模式、開發狀態、任務前 checklist、合規檢查、VPS/cron 檢查、Bug 修復流程、配置修改、技術債預防範例、跨模組修改檢查

### Step 5: 清理 settings.local.json

- 62 行 → ~10 行
- 移除：60 條累積的 permission 規則（含巨型內嵌 backtest 腳本）
- 保留：`Read(//Users/suweicheng/**)`、`additionalDirectories` for memory

### Step 6: Memory 清理

- **MEMORY.md** 瘦身：62 行 → ~30 行
  - 移除：VPS Environment 基本資訊、FMP API 注意事項、VPS SSH 操作規則、Key Learnings（11條）、溝通指南連結
  - 保留：使用者偏好、工作流程偏好、VPS Git 部署注意、OpenClaw 環境、Knowledge-Digest Agent
- **effective-prompts.md**：Layer 4-6 歸檔到 `docs/references/effective-prompts-archive.md`，原始檔案刪除
- **environments.md**：已複製到 `skills/vps-deploy/references/`，原始檔案刪除

### Step 6b: 歸檔文件

- `DEPLOYMENT_WORKFLOW.md` 移動到 `docs/deployment-workflow-archive.md`，加註「以 vps-deploy skill 為準」
- `README.md` 更新導覽表，加入 .claude/ 結構說明

### Step 7: 文件產出

- `docs/refactor/docs_spec.md` — Claude Code plugin 規格
- `docs/refactor/inventory.md` — 現況盤點
- `docs/refactor/refactor_plan.md` — 拆分映射設計
- `docs/refactor/verification.md` — 驗證清單
- `docs/refactor/CHANGELOG_refactor.md` — 本文件

## 統計

| 指標 | 重構前 | 重構後 |
|------|--------|--------|
| CLAUDE.md 行數 | 170 | ~60 |
| MEMORY.md 行數 | 62 | ~30 |
| settings.local.json 行數 | 62 | ~10 |
| 內容重複次數 | 8 組×2-4 次 | 每組 1 次（單一真實來源） |
| 每次 session 載入量 | ~1000 行（全部） | ~90 行（CLAUDE.md + CLAUDE.local.md） |
| 按需載入的工作流 | 0 | 4 個 skills |
| Subagent | 0 | 1 個 (vps-operator) |
| 自動化 hook | 0 | 1 個 (SessionStart) |
