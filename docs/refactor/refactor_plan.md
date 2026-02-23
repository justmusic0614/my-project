# 拆分映射設計

> Phase 2 產出
> 建立日期：2026-02-24

## 確認的方向決策

| 項目 | 決定 | 理由 |
|------|------|------|
| CLAUDE.md 規模 | 精簡 ~60 行 | 保留編碼規範+架構+常用命令，工作流搬到 skills |
| Skills 粒度 | 細粒度 4 個 | task-planning、vps-deploy、bug-fix、agent-scaffold 各自獨立 |
| Hooks 策略 | 最小化 | 僅 SessionStart hook（日期+語言） |
| VPS 自動化 | Skill + Subagent | vps-deploy skill + vps-operator subagent |
| effective-prompts.md | 提取 + 歸檔 | Layer 1-3→skills，Layer 4-6→docs/references/ |
| MEMORY.md | 瘦身保留 | 遷移 VPS 基本資訊和 Key Learnings 到 CLAUDE.local.md |
| CLAUDE.md 禁止條目 | 刪除多餘 3 條 | 移除工具/系統已強制的，保留 6 條 |
| Skills 觸發 | 按角色分配 | task-planning=Claude-only, bug-fix=雙向, vps-deploy=使用者-only, agent-scaffold=使用者-only |
| 權限分離 | 通用 wildcard 入庫 | settings.json 放寬泛 wildcard，settings.local.json 只留 Read |
| 備份策略 | Git tag + 目錄 | git tag pre-refactor + _backup_before_refactor/ |
| DEPLOYMENT_WORKFLOW.md | 歸檔 | 移到 docs/，加註以 skill 為準 |
| README.md | 更新導覽表 | 加入 .claude/ 結構說明 |

## 目標目錄結構

```
my-project/
├── CLAUDE.md                              # ~60 行（瘦身後）
├── CLAUDE.local.md                        # 新建（gitignored）
├── .claude/
│   ├── settings.json                      # 新建（團隊 hooks + 權限）
│   ├── settings.local.json                # 清理（僅個人權限）
│   ├── skills/
│   │   ├── task-planning/
│   │   │   ├── SKILL.md
│   │   │   └── references/
│   │   │       ├── task-templates.md
│   │   │       └── pipeline-model.md
│   │   ├── vps-deploy/
│   │   │   ├── SKILL.md
│   │   │   └── references/
│   │   │       └── environments.md
│   │   ├── bug-fix/
│   │   │   └── SKILL.md
│   │   └── agent-scaffold/
│   │       └── SKILL.md
│   └── agents/
│       └── vps-operator.md
├── docs/
│   ├── refactor/                          # 重構文件
│   ├── references/
│   │   └── effective-prompts-archive.md
│   └── deployment-workflow-archive.md
└── ...
```

## 完整 Mapping 表

| # | Source | Target | Action |
|---|--------|--------|--------|
| 1 | CLAUDE.md 全文 (170行) | CLAUDE.md (~60行) | rewrite |
| 2 | CLAUDE.md 編碼禁止事項 (10條) | CLAUDE.md (6條) | condense |
| 3 | CLAUDE.md 任務前 Checklist | skills/task-planning/SKILL.md | move |
| 4 | CLAUDE.md 合規檢查 | skills/task-planning/SKILL.md | move |
| 5 | CLAUDE.md Agent 結構 | skills/agent-scaffold/SKILL.md + CLAUDE.md 摘要 | split |
| 6 | CLAUDE.md 跨模組檢查 | skills/task-planning/references/pipeline-model.md | move |
| 7 | CLAUDE.md VPS/Cron 檢查 | skills/vps-deploy/SKILL.md | move |
| 8 | CLAUDE.md Bug 修復流程 | skills/bug-fix/SKILL.md | move |
| 9 | CLAUDE.md 配置修改 | skills/task-planning/SKILL.md | move |
| 10 | CLAUDE.md 開發狀態/執行模式 | 刪除 | delete |
| 11 | effective-prompts.md Layer 1 Checklist | skills/task-planning/SKILL.md | dedupe |
| 12 | effective-prompts.md Layer 2 模板 | skills/task-planning/references/task-templates.md | move |
| 13 | effective-prompts.md Layer 3 Pipeline | skills/task-planning/references/pipeline-model.md | move |
| 14 | effective-prompts.md Layer 4-6 | docs/references/effective-prompts-archive.md | move |
| 15 | environments.md 全文 | skills/vps-deploy/references/environments.md | move |
| 16 | MEMORY.md VPS 基本資訊 + Key Learnings | CLAUDE.local.md | move |
| 17 | MEMORY.md 語言/工作流程偏好 | MEMORY.md（保留） | keep |
| 18 | settings.local.json (62行) | settings.json + settings.local.json (~10行) | rewrite |
| 19 | DEPLOYMENT_WORKFLOW.md | docs/deployment-workflow-archive.md | move |
| 20 | README.md 導覽表 | 更新 | update |

## 去重解決方案

| 內容 | 權威來源 | 其他實例處理 |
|------|----------|-------------|
| SSH 安全規則 | skills/vps-deploy/SKILL.md | 其餘全部移除 |
| VPS 環境規格 | CLAUDE.local.md + skills/vps-deploy/references/environments.md | 其餘全部移除 |
| Pipeline 依賴模型 | skills/task-planning/references/pipeline-model.md | 其餘全部移除 |
| 任務前 Checklist | skills/task-planning/SKILL.md | 其餘全部移除 |
| Bug 修復流程 | skills/bug-fix/SKILL.md | 其餘全部移除 |
| 配置修改規則 | skills/task-planning/SKILL.md | 其餘全部移除 |
| 編碼禁止事項 | CLAUDE.md（唯一權威） | 無其他副本 |
| Key Learnings (11條) | CLAUDE.local.md | MEMORY.md 中的副本移除 |
