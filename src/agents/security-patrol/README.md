# Security Patrol Agent

資安巡邏系統，定期監控 VPS 安全狀態並推播異常警報。

## 功能

### 監控項目（8 項）
1. **SSH 登入記錄**
   - 成功/失敗次數
   - Top 5 失敗 IP
   - 異常門檻：>10 次失敗登入/小時

2. **系統更新狀態**
   - 可更新套件數量
   - 安全性更新數量
   - 異常門檻：有安全性更新

3. **防火牆狀態**
   - ufw 狀態檢測
   - 自動降級處理（權限不足/未安裝）

4. **網路連線**
   - 總連線數
   - ESTABLISHED 連線數

5. **磁碟使用率**
   - 使用百分比
   - 可用空間
   - 異常門檻：>85%

6. **CPU 使用率**
   - Load average (1/5/15 分鐘)
   - 使用百分比
   - 異常門檻：>80%

7. **Memory 使用率**
   - 總量/已用/可用
   - 使用百分比
   - 異常門檻：>85%

8. **Process 狀態**
   - clawdbot-gateway
   - node processes
   - 異常門檻：任一 process 未執行

## 推播規則（模式 B）

- **每小時巡邏**：檢測異常 → 立即推播
- **每日 08:00**：推送完整日報（無論有無異常）

## 檔案結構

```
security-patrol/
├── config.json              # 設定檔（門檻值、監控項目）
├── patrol.js                # 主程式（巡邏邏輯）
├── patrol-wrapper.sh        # 包裝腳本（整合推播）
├── setup-cron.sh            # Cron 安裝腳本
├── README.md                # 說明文件
├── data/
│   ├── runtime/
│   │   └── latest.json      # 最新巡邏結果
│   └── history/
│       └── YYYY-MM-DD.jsonl # 歷史記錄（JSONL 格式）
└── logs/
    ├── patrol.log           # 巡邏執行記錄
    ├── daily-report.log     # 日報推播記錄
    └── push.log             # Telegram 推播記錄
```

## 使用方式

### 安裝 Cron Jobs

```bash
cd ~/clawd/agents/security-patrol
bash setup-cron.sh
```

### 手動執行

```bash
# 執行巡邏（檢測異常並推播）
bash patrol-wrapper.sh patrol

# 生成日報（並推播）
bash patrol-wrapper.sh report

# 查看狀態
bash patrol-wrapper.sh status
```

### 查看記錄

```bash
# 最新巡邏結果
cat data/runtime/latest.json | jq

# 巡邏執行記錄
tail -f logs/patrol.log

# 日報推播記錄
tail -f logs/daily-report.log

# Telegram 推播記錄
tail -f logs/push.log
```

## 設定調整

編輯 `config.json`：

```json
{
  "thresholds": {
    "ssh_failed_logins": 10,      // SSH 失敗登入門檻
    "disk_usage_percent": 85,     // 磁碟使用率門檻
    "cpu_usage_percent": 80,      // CPU 使用率門檻
    "memory_usage_percent": 85    // Memory 使用率門檻
  },
  "processes": [
    "clawdbot-gateway",           // 監控的 processes
    "node"
  ]
}
```

## Cron Jobs

- **每小時巡邏**：`0 * * * *`
- **每日日報**：`0 0 * * *` (UTC 00:00 = 台北 08:00)

## 異常嚴重程度

- 🔴 **CRITICAL**：防火牆未啟動
- 🟠 **HIGH**：Process 停止、磁碟 >95%、CPU >95%
- 🟡 **MEDIUM**：SSH 異常、系統更新、資源使用高

## 權限需求

- SSH 登入記錄：需讀取 `/var/log/auth.log` (sudo)
- 防火牆檢測：需執行 `ufw status` (sudo)
- 其他監控：不需 sudo

**註**：若無 sudo 權限，防火牆檢測會自動降級，不影響其他監控。

## 疑難排解

### Cron 未執行

```bash
# 檢查 crontab
crontab -l | grep patrol

# 檢查 cron service
systemctl status cron

# 檢查執行記錄
tail -f ~/clawd/agents/security-patrol/logs/patrol.log
```

### 推播失敗

```bash
# 檢查推播記錄
tail -f ~/clawd/agents/security-patrol/logs/push.log

# 手動測試推播
clawdbot message send --channel telegram --target REDACTED_CHAT_ID --message "測試推播"
```

### 調整時區

預設使用 UTC 時間。台北時間 (UTC+8) 的對應：
- 00:00 UTC = 08:00 台北
- 12:00 UTC = 20:00 台北

## 改進建議（已實作）

✅ Process 監控（取代 systemd service）  
✅ 防火牆智慧檢測（降級處理）  
✅ 異常嚴重程度分級  
✅ Telegram 整合推播  
✅ 歷史記錄（JSONL 格式）  
✅ 完整日報格式  

## 未來擴充

- [ ] 異常趨勢分析（連續 3 次異常才推播）
- [ ] 白名單 IP（SSH 失敗不計入）
- [ ] 更多監控項目（Docker、Nginx、Database）
- [ ] 網頁儀表板（可視化）
