# 環境差異參考表

> 當任務涉及 VPS 或 cron 時，務必查閱此表

## 三種執行環境

| 項目 | Local (macOS) | VPS (Linux) | VPS cron |
| --- | --- | --- | --- |
| OS | Darwin 24.6.0 | Ubuntu (x86_64) | 同 VPS |
| Shell | zsh (interactive) | bash 5.x (interactive) | sh (non-interactive) |
| RAM | 16GB+ | 2GB（~1.1GB 可用） | 同 VPS |
| CPU | Apple Silicon / Intel | 2 core x86_64 | 同 VPS |
| Node.js | 系統安裝 | v22.22.0 (nvm) | 需 nvm 載入 |
| bash 版本 | 3.2（macOS 內建） | 5.x | 5.x |

## 關鍵差異

### 環境變數

| 變數 | Local | VPS interactive | VPS cron |
| --- | --- | --- | --- |
| PATH | 完整（含 nvm） | 完整（含 nvm） | 最小化，需手動載入 nvm |
| XDG_RUNTIME_DIR | 自動設定 | 自動設定 | 無，需手動 export |
| DBUS_SESSION_BUS_ADDRESS | 自動設定 | 自動設定 | 無，需手動 export |
| HOME | /Users/suweicheng | /home/clawbot | /home/clawbot |

### dotenv 載入

| 方式 | Local | VPS interactive | VPS cron |
| --- | --- | --- | --- |
| `source .env` | 載入但不 export | 載入但不 export | 載入但不 export |
| `set -a && source .env && set +a` | export 給子進程 | export 給子進程 | export 給子進程 |
| Node.js `dotenv` | 自動（index.js 統一管理） | 需指定路徑 | 需指定路徑 |

### systemd 服務管理

| 操作 | Local | VPS interactive | VPS cron |
| --- | --- | --- | --- |
| `systemctl --user status` | N/A（macOS 用 launchctl） | 正常 | 需先 export XDG_RUNTIME_DIR |
| `systemctl --user is-active` | N/A | 正常 | 需先 export XDG_RUNTIME_DIR |

**cron 環境修復方式：**

```bash
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"
```

### bash 語法差異

| 語法 | macOS bash 3.2 | VPS bash 5.x |
| --- | --- | --- |
| `declare -A` (associative array) | 不支援 | 支援 |
| `${var,,}` (lowercase) | 不支援 | 支援 |
| `case` 語句 | 支援 | 支援 |

**跨平台安全選擇：** 使用 `case` 語句取代 `declare -A`。

## VPS 部署路徑對照

| 用途 | Local (my-project) | VPS (clawd) |
| --- | --- | --- |
| Agent 根目錄 | `src/agents/` | `agents/` |
| 共享模組 | `src/shared/` | `shared/` |
| market-digest | `src/agents/market-digest/` | `agents/market-digest/` |
| 環境變數 | `.env` | `~/clawd/.env`（集中管理） |
| Git 分支 | main | master |

**注意：** 兩個 repo 是 unrelated histories，不能 merge，只能用 `git show origin/main:src/... > agents/...` 逐檔同步。

## 資源限制速查

- **RAM 安全線** — 不要使用超過 ~300MB 的 Node.js 進程（1.1GB 要留給 OS + PM2 + 多個 agent）
- **PM2 記憶體重啟** — 設定 max_memory_restart: 256M
- **CPU load 正常值** — 2-core VPS 的 load average 0.8-1.3 是正常的
- **Ollama** — nomic-embed-text 274MB，不要同時跑其他大模型
