# 現況盤點

> Phase 1 產出
> 建立日期：2026-02-24

## 所有相關檔案清單

| 檔案 | 行數 | 位置 | 入庫? | 歸屬判斷 |
|------|------|------|-------|----------|
| `CLAUDE.md` | 170 | 專案根目錄 | Yes | 瘦身 → ~60 行（僅保留編碼規範+架構） |
| `MEMORY.md` | 62 | `~/.claude/projects/.../memory/` | No | 瘦身 → ~30 行（部分遷移到 CLAUDE.local.md） |
| `effective-prompts.md` | 708 | `~/.claude/projects/.../memory/` | No | 拆分 → Layer 1-3→skills，Layer 4-6→docs/references/ |
| `environments.md` | 85 | `~/.claude/projects/.../memory/` | No | 移動 → `.claude/skills/vps-deploy/references/` |
| `.claude/settings.local.json` | 62 | 專案 .claude/ | No | 清理 → 移除內嵌腳本，權限移到 settings.json |
| `DEPLOYMENT_WORKFLOW.md` | 275 | 專案根目錄 | Yes | 歸檔 → `docs/deployment-workflow-archive.md` |
| `.git/hooks/post-commit` | 47 | Git hooks | Local | 保持不動（Git 原生 hook） |
| `README.md` | 52 | 專案根目錄 | Yes | 更新導覽表 |

## 重複/衝突清單

| 內容 | 出現位置（次數） |
|------|-----------------|
| SSH 安全規則 | CLAUDE.md, MEMORY.md, environments.md, effective-prompts.md（4次） |
| VPS 環境規格 | MEMORY.md, environments.md, effective-prompts.md（3次） |
| Pipeline 依賴模型 | CLAUDE.md, effective-prompts.md×2（3次） |
| 任務前 Checklist | CLAUDE.md, effective-prompts.md（2次） |
| Bug 修復流程 | CLAUDE.md, effective-prompts.md（2次） |
| 配置修改規則 | CLAUDE.md, effective-prompts.md（2次） |
| 跨模組修改檢查 | CLAUDE.md, effective-prompts.md（2次） |
| VPS 部署路徑對照 | MEMORY.md, environments.md, DEPLOYMENT_WORKFLOW.md（3次） |
