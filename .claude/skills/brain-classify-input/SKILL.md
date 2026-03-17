---
name: brain-classify-input
description: |
  分類使用者輸入的來源型態，輸出 human-readable summary 與 machine-readable JSON routing payload。
  支援單一輸入與多輸入。
  類型包含：
  BRAIN_MD / OTHER_MD / LOCAL_MEDIA / URL_VIDEO / UNKNOWN

  用法：
    /brain-classify-input <input>
tools: Read
user-invocable: true
---

## Purpose

此 skill 是所有 brain workflows 的前置 routing layer。

它負責：
- 解析單一或多個輸入
- 逐一分類輸入型態
- 逐一輸出唯一正確的下一步
- 產生 JSON routing payload，供其他 agents / hooks / skills 使用

此 skill 不負責：
- 執行 kd / kd-local
- 執行 ingest / review
- 假設檔案存在
- 模擬工具結果

---

## Execution Boundary

Claude 只能：
- 解析輸入
- 根據規則分類
- 輸出 human summary
- 輸出 JSON routing payload

Claude 不得：
- 執行 kd / kd-local
- 執行 brain-ingest / brain-review
- 猜測路徑或 URL
- 因某工具失敗而改用另一個工具
- 模擬執行結果

---

## Classification Rules

### URL_VIDEO

條件：
- 以 `http://` 或 `https://` 開頭

Next Action：
- `kd process "<url>" --style brain`

Forbidden：
- 不要用 `kd-local` 處理 URL

---

### LOCAL_MEDIA

條件：
- 以 `/`, `./`, `../`, `~/` 開頭，且副檔名為媒體檔
- 或含副檔名：mp4, mkv, mov, avi, webm, mp3, wav, m4a, flac, ogg, aac
- 但不是 URL

Next Action：
- `kd-local "<path>" --style brain`

Forbidden：
- 不要用 `kd process` 處理本地檔案

---

### BRAIN_MD

條件：
必須符合以下至少一項：
- 檔名包含 `brain`, `digest`, `knowledge`
- 使用者明確表示是 brain markdown
- 明顯來自 brain pipeline 輸出

`.md` 不可預設視為 BRAIN_MD

Next Action：
- 若使用者意圖為 ingest → `/brain-ingest <file>`
- 若使用者意圖為 review → `/brain-review <file>`
- 若意圖不明 → ask_user

---

### OTHER_MD

條件：
- `.md` 結尾
- 但不符合 BRAIN_MD

Next Action：
- 提示需先整理為 brain markdown
- 或 ask_user 確認用途

---

### UNKNOWN

條件：
- 不符合以上任一條件

Next Action：
- ask_user 要求提供明確路徑、URL 或 brain markdown

Forbidden：
- 不得猜測完整檔名
- 不得猜測本地路徑
- 不得自行決定 kd / kd-local

---

## Priority Rules

1. URL 優先於副檔名（`https://example.com/video.mp4` → URL_VIDEO）
2. 本地路徑 + 媒體副檔名 → LOCAL_MEDIA
3. `.md` 預設 OTHER_MD，再判斷是否升級為 BRAIN_MD
4. 其餘 → UNKNOWN

---

## Multi-Input Rule

若輸入包含多個來源：

- 必須逐一分類
- 每個輸入各自輸出一個 item
- 不可用單一工具處理全部輸入
- 最後輸出 overall routing decision

---

## Error Handling

- 不要因為 kd-local 失敗就改用 kd
- 不要因為 kd 失敗就改用 kd-local
- 若分類已明確，先檢查：
  1. 輸入型態是否正確
  2. 路徑 / URL 是否合理
  3. 副檔名是否支援

---

## JSON Output Schema

```json
{
  "version": "2.0",
  "mode": "human+json",
  "summary": {
    "total_inputs": 0,
    "classified": 0,
    "unclassified": 0
  },
  "items": [
    {
      "index": 1,
      "raw_input": "",
      "type": "LOCAL_MEDIA",
      "confidence": "HIGH",
      "reasons": [],
      "next_action": {
        "kind": "command",
        "tool": "kd-local",
        "command": "",
        "route_to": "kd-local"
      },
      "forbidden": [],
      "needs_user_input": false
    }
  ],
  "routing_decision": {
    "status": "READY",
    "next_targets": []
  }
}
```

---

## Output Contract

每次輸出必須包含兩部分：

### Part 1: Human Summary

- Input Classification Summary
- Overall Routing

### Part 2: JSON Routing Payload

- 合法 JSON，可供下游 agent 解析

## Routing Status Enum

- READY
- NEEDS_USER_INPUT
- PARTIALLY_READY
- BLOCKED

## Next Action Kind Enum

- command
- skill
- ask_user
