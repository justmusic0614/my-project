# CLAUDE.md - my-project

> **最後更新**: 2026-02-24
> **描述**: JavaScript CLI 工具 + Task Agents

## 編碼規範

### 絕對禁止事項

- **絕不** 在根目錄建立新檔案 — 使用適當的模組結構
- **絕不** 建立重複檔案（manager_v2.js, enhanced_xyz.js）— 擴展現有檔案
- **絕不** 對同一概念建立多個實作 — 單一真實來源
- **絕不** 複製貼上程式碼區塊 — 提取到共用工具/函式
- **絕不** 硬編碼應該可配置的數值 — 使用配置檔案/環境變數
- **絕不** 使用 enhanced_、improved_、new_、v2_ 等命名 — 擴展原始檔案

### 強制要求

- **提交** 每個完成的任務/階段後
- **GITHUB 備份** — 每次提交後: `git push origin main`
- **Task Agents** — 長時間操作（>30 秒）使用 Task agents
- **債務預防** — 建立新檔案前，檢查是否有現有功能可擴展

## 專案結構

```
src/main/js/          # JavaScript 原始碼（core/, utils/, models/, services/, api/）
src/main/resources/   # 配置和資源
src/test/             # 測試
src/agents/           # Task agents（各有獨立結構）
src/shared/           # 共享模組（agent-template/）
docs/                 # 文件
tools/                # 開發工具
```

## Agent 結構摘要

新 agent 必須遵循 `src/shared/agent-template/`：
- 強制：`agent.js`、`config.json`、`README.md`、`src/`、`data/runtime/`
- 選用：`sre/`、`logs/`、`references/`
- 例外：market-digest 維持 `backend/`
- 詳細規範見 `.claude/skills/agent-scaffold/SKILL.md`

## .claude/ 結構

| 載體 | 位置 | 用途 |
|------|------|------|
| Skills | `.claude/skills/task-planning/` | 複雜任務前置規劃（Claude-only） |
| Skills | `.claude/skills/vps-deploy/` | VPS 部署操作（`/vps-deploy`） |
| Skills | `.claude/skills/bug-fix/` | Bug 修復流程（雙向） |
| Skills | `.claude/skills/agent-scaffold/` | Agent 建立模板（`/agent-scaffold`） |
| Agents | `.claude/agents/vps-operator.md` | VPS 操作 subagent |
| Settings | `.claude/settings.json` | 團隊權限 + hooks |

## 常用命令

```bash
node src/main/js/index.js    # 執行 CLI
npm test                      # 測試
git push origin main          # 備份到 GitHub
./tools/deploy.sh <agent>    # 部署到 VPS
```
