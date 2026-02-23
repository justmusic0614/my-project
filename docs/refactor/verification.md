# 驗證清單

> Phase 4 產出
> 建立日期：2026-02-24

## 驗證項目

| # | 檢查項目 | 驗證方法 | 預期結果 | 狀態 |
|---|---------|---------|---------|------|
| 1 | CLAUDE.md 載入 | 開新 session，問 Claude「CLAUDE.md 說什麼」 | 能引述編碼規範 6 條 | 待驗 |
| 2 | CLAUDE.local.md 載入 | 開新 session，確認 Claude 知道 VPS 資訊 | 能回答 VPS RAM、IP | 待驗 |
| 3 | task-planning skill | 開新 session，下複雜任務指令 | Claude 自動執行 checklist | 待驗 |
| 4 | vps-deploy skill | 輸入 `/vps-deploy` | 顯示 VPS 部署流程 | 待驗 |
| 5 | bug-fix skill | 描述一個 bug | Claude 自動套用 bug-fix 流程 | 待驗 |
| 6 | agent-scaffold skill | 輸入 `/agent-scaffold` | 顯示 agent 建立模板 | 待驗 |
| 7 | vps-operator agent | 請 Claude 檢查 VPS 狀態 | 委派給 vps-operator | 待驗 |
| 8 | SessionStart hook | 開新 session | 顯示日期和語言提示 | 待驗 |
| 9 | settings.json 權限 | 執行 `node --version`、`git status` | 不需要額外確認 | 待驗 |
| 10 | 無內容遺失 | 比對 backup 和新結構 | 所有原始內容都有歸屬 | 待驗 |
| 11 | 無重複 | Grep 搜尋關鍵短語 | 每個短語只在權威來源出現 | 待驗 |

## 可執行的驗證命令

```bash
# 確認所有新檔案存在
ls -la .claude/settings.json
ls -la .claude/skills/task-planning/SKILL.md
ls -la .claude/skills/task-planning/references/task-templates.md
ls -la .claude/skills/task-planning/references/pipeline-model.md
ls -la .claude/skills/vps-deploy/SKILL.md
ls -la .claude/skills/vps-deploy/references/environments.md
ls -la .claude/skills/bug-fix/SKILL.md
ls -la .claude/skills/agent-scaffold/SKILL.md
ls -la .claude/agents/vps-operator.md
ls -la CLAUDE.local.md
ls -la docs/references/effective-prompts-archive.md
ls -la docs/deployment-workflow-archive.md

# 確認 CLAUDE.md 行數合理
wc -l CLAUDE.md  # 預期 ~60 行

# 確認 settings.local.json 已清理
wc -l .claude/settings.local.json  # 預期 ~10 行

# 確認 .gitignore 包含 CLAUDE.local.md
grep "CLAUDE.local.md" .gitignore

# 確認備份完整
ls _backup_before_refactor/

# 確認原始檔案已移除
ls ~/.claude/projects/-Users-suweicheng-projects-my-project/memory/
# 預期：只有 MEMORY.md

# 確認重複已移除（SSH 規則只出現在 skill 中）
grep -r "SSH 指令逐一發送\|指令必須逐一發送" --include="*.md" -l
# 預期：只有 .claude/skills/vps-deploy/ 和 docs/ 歸檔檔案

grep -r "Pipeline 依賴模型\|Pipeline 依賴" --include="*.md" -l
# 預期：只有 .claude/skills/task-planning/references/
```

## 回滾方式

如果需要回滾：

```bash
# 回滾 git tracked 檔案
git checkout pre-refactor -- CLAUDE.md .gitignore README.md DEPLOYMENT_WORKFLOW.md .claude/settings.local.json

# 回滾 memory 檔案
cp _backup_before_refactor/MEMORY.md ~/.claude/projects/-Users-suweicheng-projects-my-project/memory/
cp _backup_before_refactor/effective-prompts.md ~/.claude/projects/-Users-suweicheng-projects-my-project/memory/
cp _backup_before_refactor/environments.md ~/.claude/projects/-Users-suweicheng-projects-my-project/memory/

# 移除新建檔案
rm -rf .claude/skills/ .claude/agents/ .claude/settings.json CLAUDE.local.md
rm -rf docs/refactor/ docs/references/ docs/deployment-workflow-archive.md
```
