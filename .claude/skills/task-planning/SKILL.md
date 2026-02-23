---
name: task-planning
description: |
  複雜任務的前置規劃流程。當開始新功能、API 整合、跨模組修改、重構、
  配置調整等複雜任務時自動套用。執行 checklist 驗證和影響範圍分析。
tools: Read, Grep, Glob
user-invocable: false
---

## 任務前 Checklist

開始複雜任務前，確認用戶已提供：

1. **目標環境** — local / VPS / cron
   所有任務必須在完成前填寫環境驗收矩陣（每欄都要確認）：
   - [ ] local 執行正常
   - [ ] VPS 手動執行正常（若會部署到 VPS）
   - [ ] VPS cron 執行正常（若會排程執行）
2. **影響模組** — 所有受影響的檔案/層
3. **外部依賴** — API 版本、已知限制、資源上限
   - API 端點版本必須確認（FMP 用 `/stable/` 非 `/api/v3/`；Yahoo Finance 端點隨時可能調整）
   - 獨立工具/腳本需自行 `require('dotenv').config()`（不繼承主程序環境）
4. **驗收條件** — 怎樣算完成、怎麼測試
5. **已知地雷** — 過去踩過的坑

若有缺漏，主動向用戶詢問。

## 合規檢查

開始任何任務前驗證：

- 根目錄建檔？→ 改用模組結構
- 超過 30 秒？→ Task agents
- 類似功能存在？→ 先搜尋，擴展現有
- 重複類別？→ 整合
- 可擴展現有？→ 優先擴展

## 跨模組修改強制檢查

當任務涉及修改被其他模組依賴的程式碼時：

1. 先用 Grep 搜尋所有 import/require 該模組的檔案
2. 列出完整影響範圍，讓用戶確認
3. 按 Pipeline 依賴模型逐層檢查（見 references/pipeline-model.md）

## 配置/閾值修改規則

修改配置值時：

1. 用 Grep 搜尋所有讀取該配置的地方
2. 確認所有地方都一致更新
3. 閾值設定需基於實際觀測數據，不要猜測

## 參考資料

- [references/task-templates.md](references/task-templates.md) — 6 種任務類型模板（新功能、Bug 修復、API 整合、部署、配置調整、重構）
- [references/pipeline-model.md](references/pipeline-model.md) — Pipeline 依賴模型（收集→轉發→處理→驗證→渲染→推播）
