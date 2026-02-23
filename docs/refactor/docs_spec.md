# Claude Code Plugin 規格文件

> Phase 0 產出
> 建立日期：2026-02-24

## 規格來源

從 Claude Code 官方 plugins（example-plugin、feature-dev、plugin-dev、claude-code-setup）及官方文檔提取。

## 載體規格

| 載體 | 位置 | 用途 | 載入時機 |
|------|------|------|----------|
| CLAUDE.md | 專案根目錄 | 專案級規範、編碼標準、架構概覽 | 每次 session 自動載入 |
| CLAUDE.local.md | 專案根目錄（gitignored） | 個人偏好、敏感資訊、環境特定內容 | 每次 session 自動載入 |
| skills/ | `.claude/skills/<name>/SKILL.md` | 可重用工作流/知識，按需載入 | Claude 偵測到相關任務時或使用者 `/skill-name` |
| agents/ | `.claude/agents/<name>.md` | 專門角色 subagent，受限工具 | Claude 委派或使用者要求 |
| hooks | `.claude/settings.json` 中的 `hooks` 區段 | 自動化守門和事件回應 | 對應事件觸發時 |
| settings.json | `.claude/settings.json`（checked in） | 團隊共享權限和 hooks | 每次 session |
| settings.local.json | `.claude/settings.local.json`（gitignored） | 個人權限覆寫 | 每次 session |

## Skills 規格

- **Frontmatter**: `name`, `description`, `tools`, `user-invocable`, `disable-model-invocation`, `context`, `agent`
- **子目錄支援**: `references/`, `examples/`, `scripts/`
- **觸發模式**:
  - `user-invocable: false` = Claude-only（背景知識，Claude 偵測到相關任務時自動載入）
  - `disable-model-invocation: true` = 使用者-only（有副作用的操作，需 `/skill-name` 觸發）
  - 預設 = 雙向（Claude 自動 + 使用者手動皆可）

## Hooks 規格

- **事件類型**: PreToolUse, PostToolUse, Stop, SessionStart, UserPromptSubmit
- **實作方式**:
  - `command`（shell 腳本）— 快速、確定性
  - `prompt`（LLM 評估）— 靈活但慢
- **matcher**: 工具名稱或路徑 pattern

## Agents (Subagents) 規格

- **Frontmatter**: `name`, `description`, `tools`, `model`, `color`
- **description 中使用 `<example>` 區塊** 提高觸發可靠性
- **工具權限分級**: 唯讀 / 寫入 / 完整
- **執行環境**: Fork context，由主 session 委派
