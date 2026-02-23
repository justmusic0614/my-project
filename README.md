# my-project

使用 JavaScript 建構的 CLI 工具。

## 📚 文件導覽

| 文件 | 用途 | 適合對象 |
|------|------|----------|
| **[CLAUDE.md](CLAUDE.md)** | Claude Code 編碼規範、專案結構 | Claude Code AI、開發者 |
| **[docs/deployment-workflow-archive.md](docs/deployment-workflow-archive.md)** | VPS 部署流程（人類參考） | 開發者、運維人員 |
| **[scripts/README_VPS_SYNC.md](scripts/README_VPS_SYNC.md)** | VPS 同步機制詳細說明 | 進階開發者 |

### Claude Code 配置 (.claude/)

| 位置 | 用途 |
|------|------|
| `.claude/settings.json` | 團隊共享權限 + SessionStart hook |
| `.claude/skills/task-planning/` | 複雜任務前置規劃（Claude 自動套用） |
| `.claude/skills/vps-deploy/` | VPS 部署操作（`/vps-deploy` 觸發） |
| `.claude/skills/bug-fix/` | Bug 修復流程（雙向觸發） |
| `.claude/skills/agent-scaffold/` | Agent 建立模板（`/agent-scaffold` 觸發） |
| `.claude/agents/vps-operator.md` | VPS 操作 subagent |

## 快速開始

1. **先閱讀 CLAUDE.md** - 包含 Claude Code 的重要規則
2. 開始任何工作前，遵循任務前合規檢查清單
3. 在 `src/main/js/` 下使用適當的模組結構
4. 每個任務完成後都要提交

## 專案結構

```
my-project/
├── CLAUDE.md              # Claude Code 的重要規則
├── README.md              # 專案說明文件
├── .gitignore             # Git 忽略規則
├── src/
│   ├── main/
│   │   ├── js/            # JavaScript 原始碼
│   │   │   ├── core/      # 核心業務邏輯
│   │   │   ├── utils/     # 工具函式
│   │   │   ├── models/    # 資料模型
│   │   │   ├── services/  # 服務層
│   │   │   └── api/       # API 介面
│   │   └── resources/     # 非程式碼資源
│   │       ├── config/    # 配置檔案
│   │       └── assets/    # 靜態資源
│   └── test/              # 測試程式碼
│       ├── unit/          # 單元測試
│       └── integration/   # 整合測試
├── .claude/
│   ├── settings.json      # 團隊權限 + hooks
│   ├── skills/            # Claude Code skills（按需載入）
│   └── agents/            # Claude Code subagents
├── docs/                  # 文件
├── tools/                 # 開發工具和腳本
├── examples/              # 使用範例
└── output/                # 生成的輸出檔案
```

## 開發指引

- **永遠先搜尋** 再建立新檔案
- **擴展現有** 功能而非重複建立
- 所有功能都要有 **單一真實來源**
