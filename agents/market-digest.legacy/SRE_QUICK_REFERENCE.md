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
