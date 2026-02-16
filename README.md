# my-project

使用 JavaScript 建構的 CLI 工具。

## 📚 文件導覽

| 文件 | 用途 | 適合對象 |
|------|------|----------|
| **[CLAUDE.md](CLAUDE.md)** | Claude Code AI 工作規範、開發規範、技術債預防 | Claude Code AI、開發者 |
| **[DEPLOYMENT_WORKFLOW.md](DEPLOYMENT_WORKFLOW.md)** | VPS 部署完整流程、環境架構說明、疑難排解 | 開發者、運維人員 |
| **[scripts/README_VPS_SYNC.md](scripts/README_VPS_SYNC.md)** | VPS 同步機制詳細說明 | 進階開發者 |

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
├── docs/                  # 文件
├── tools/                 # 開發工具和腳本
├── examples/              # 使用範例
└── output/                # 生成的輸出檔案
```

## 開發指引

- **永遠先搜尋** 再建立新檔案
- **擴展現有** 功能而非重複建立
- 所有功能都要有 **單一真實來源**
