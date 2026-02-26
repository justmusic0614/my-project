# Market Digest Agent - SRE 快速參考

## 🚀 快速指令

### 健康檢查
```bash
cd ~/clawd/agents/market-digest
node sre/production-readiness-report.js
```

### 依賴檢查
```bash
node sre/dependency-checker.js --fix
```

### 測試 SRE 系統
```bash
node sre/test-sre-systems.js
```

### 測試 Crash 抵抗力
```bash
node test-crash-resistance.js
```

### 手動執行報告生成
```bash
node smart-integrator.js integrate  # 只生成，不推播
node smart-integrator.js push       # 生成並推播
```

### 測試 Cron Wrapper
```bash
bash sre/cron-wrapper.sh test-task "echo 'test'"
```

---

## 📁 重要檔案位置

### SRE 系統
```
sre/
├── dependency-checker.js        # 依賴檢查
├── circuit-breaker.js           # 熔斷器
├── graceful-degradation.js      # 優雅降級
├── health-check.js              # 健康檢查
├── cron-wrapper.sh              # Cron wrapper
└── production-readiness-report.js  # 生產就緒報告
```

### 日誌
```
logs/
├── cron-YYYY-MM-DD.log          # Cron 執行日誌
├── error-YYYY-MM-DD.log         # 錯誤日誌
└── circuit-breaker-*.log        # 熔斷器日誌
```

### 快取與數據
```
data/
├── cache/
│   └── news-raw.json            # 新聞快取
├── runtime/
│   └── morning-report.txt       # 最新報告
└── morning-collect/
    └── YYYY-MM-DD.json          # 每日收集
```

---

## 📊 歷史數據工具

### 查詢歷史數據（query-history.js）

```bash
cd ~/clawd/agents/market-digest

# 查詢最近 N 天（period: 30d / 90d / 180d / 1y / all）
node tools/query-history.js SP500 30d
node tools/query-history.js VIX 90d
node tools/query-history.js TAIEX 1y

# 指定日期範圍
node tools/query-history.js SP500 --from 2025-01-01 --to 2025-12-31

# 統計摘要（count / mean / min / max / stddev）
node tools/query-history.js VIX 90d --stats

# JSON 格式輸出（預設 CSV）
node tools/query-history.js SP500 90d --format json

# 查詢全部歷史數據
node tools/query-history.js GOLD all

# 列出所有可用指標
node tools/query-history.js --list
# → SP500, NASDAQ, TAIEX, VIX, DXY, US10Y, GOLD, OIL_WTI, COPPER, BTC, USDTWD, FED_RATE, HY_SPREAD
```

### 批次匯入歷史數據（import-history.js）

> 用於一次性補入過去數年數據，或定期補齊缺口。
> 配額估算（4 年）：FMP ~8 calls、Yahoo ~2 calls、FRED ~2 calls、FinMind ~1 call

```bash
cd ~/clawd/agents/market-digest

# 標準匯入（from 指定日期 ~ 今天）
node tools/import-history.js --from 2022-01-01

# 指定起訖範圍
node tools/import-history.js --from 2022-01-01 --to 2026-02-26

# Dry-run：只顯示統計，不寫入 DB
node tools/import-history.js --from 2025-01-01 --dry-run
```

### 直接查詢 SQLite

```bash
cd ~/clawd/agents/market-digest

# 查看最新 5 筆
node -e "
const db = require('better-sqlite3')('./data/market-history.db');
const rows = db.prepare('SELECT date, sp500, taiex, vix, gold FROM market_snapshots ORDER BY date DESC LIMIT 5').all();
console.table(rows);
db.close();
"

# 資料庫統計（筆數、日期範圍、品質分布）
node -e "
const db = require('better-sqlite3')('./data/market-history.db');
const s = db.prepare('SELECT COUNT(*) t, MIN(date) f, MAX(date) to_, SUM(CASE WHEN source_quality=\"full\" THEN 1 END) full_cnt FROM market_snapshots').get();
console.log(\`共 \${s.t} 筆  |  \${s.f} ~ \${s.to_}  |  full: \${s.full_cnt}\`);
db.close();
"

# SP500 20日移動平均（最近 10 筆）
node -e "
const db = require('better-sqlite3')('./data/market-history.db');
const rows = db.prepare(\`
  SELECT date, sp500,
    ROUND(AVG(sp500) OVER (ORDER BY date ROWS 19 PRECEDING), 2) AS ma20
  FROM market_snapshots ORDER BY date DESC LIMIT 10
\`).all();
console.table(rows);
db.close();
"

# VIX > 25 的所有日期（高波動行情）
node -e "
const db = require('better-sqlite3')('./data/market-history.db');
const rows = db.prepare('SELECT date, vix, sp500_chg FROM market_snapshots WHERE vix > 25 ORDER BY date DESC').all();
console.table(rows);
db.close();
"
```

### 數據庫位置

```text
data/market-history.db   # SQLite，永久保留
                          # 每日由 archive-publisher 自動寫入（Phase 4 後）
```

---

## 🔍 故障排除

### 問題：Cron job 未執行

**檢查**:
```bash
# 1. 檢查 crontab
crontab -l | grep market-digest

# 2. 檢查日誌
tail -f ~/clawd/agents/market-digest/logs/cron-$(date +%Y-%m-%d).log

# 3. 檢查權限
ls -la ~/clawd/agents/market-digest/sre/cron-wrapper.sh
```

**解決**:
```bash
chmod +x ~/clawd/agents/market-digest/sre/cron-wrapper.sh
```

---

### 問題：API 失敗

**檢查 Circuit Breaker 狀態**:
```bash
node -e "
const { getManager } = require('./sre/circuit-breaker');
const manager = getManager();
console.log(JSON.stringify(manager.getStatus(), null, 2));
"
```

**重置 Circuit Breaker**:
```bash
node -e "
const { getManager } = require('./sre/circuit-breaker');
const manager = getManager();
manager.resetAll();
console.log('Circuit breakers 已重置');
"
```

---

### 問題：記憶體使用過高

**檢查**:
```bash
node -e "
const used = process.memoryUsage();
console.log('Heap Used:', (used.heapUsed / 1024 / 1024).toFixed(2), 'MB');
console.log('RSS:', (used.rss / 1024 / 1024).toFixed(2), 'MB');
"
```

**解決**: 重新啟動服務或檢查是否有記憶體洩漏

---

### 問題：依賴缺失

**檢查並自動修復**:
```bash
node sre/dependency-checker.js --fix
```

---

## 📊 監控指標

### 關鍵指標

| 指標 | 正常範圍 | 警告 | 嚴重 |
|------|---------|------|------|
| 記憶體使用 | < 100 MB | 100-500 MB | > 500 MB |
| API 失敗率 | < 1% | 1-5% | > 5% |
| Circuit Breaker OPEN | 0 | 1-2 | > 2 |
| 降級模式 | false | - | true |

### 檢查指令
```bash
# 健康狀態
node -e "
const { createHealthCheckSystem } = require('./sre/health-check');
(async () => {
  const hc = createHealthCheckSystem();
  const status = await hc.runAll();
  console.log('Status:', status.status);
})();
"

# Circuit Breaker
node -e "
const { getManager } = require('./sre/circuit-breaker');
const status = getManager().getStatus();
Object.values(status).forEach(s => {
  console.log(s.name, ':', s.state);
});
"
```

---

## 🔧 維護任務

### 每日（自動）
- ✅ 健康檢查（via cron wrapper）
- ✅ 日誌清理（保留 7 天）

### 每週（手動）
```bash
# 1. 執行生產就緒檢查
node sre/production-readiness-report.js

# 2. 檢查錯誤日誌
tail -100 logs/error-$(date +%Y-%m-%d).log

# 3. 檢查 Circuit Breaker 日誌
cat logs/circuit-breaker-*.log | tail -20
```

### 每月（手動）
```bash
# 1. 更新依賴
npm update

# 2. 執行完整測試
node sre/test-sre-systems.js
node test-crash-resistance.js
node test-error-handler.js

# 3. 檢查磁碟使用
du -sh data/ logs/
```

---

## 🚨 緊急響應

### Cron job 完全失敗

```bash
# 1. 檢查最近的錯誤日誌
tail -100 logs/error-$(date +%Y-%m-%d).log

# 2. 手動執行報告生成
cd ~/clawd/agents/market-digest
node smart-integrator.js push

# 3. 如果成功，檢查 cron 設定
crontab -e
```

### API 完全無法連線

```bash
# 1. 檢查 Circuit Breaker
node -e "const { getManager } = require('./sre/circuit-breaker'); console.log(getManager().getStatus());"

# 2. 檢查降級狀態
node -e "const { getInstance } = require('./sre/graceful-degradation'); console.log(getInstance().getStatus());"

# 3. 使用快取資料（如果有）
ls -lh data/cache/

# 4. 等待自動恢復或手動重置
node -e "const { getManager } = require('./sre/circuit-breaker'); getManager().resetAll();"
```

---

## 📞 聯絡資訊

- **文件**: `SRE_100_PERCENT_REPORT.md`
- **日誌**: `logs/`
- **設定**: `config.json`
- **Cron**: `crontab -l | grep market-digest`

---

**快速參考版本**: 1.0.0  
**最後更新**: 2026-02-02
