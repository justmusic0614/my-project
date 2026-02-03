# AGENTS.md - Core Rules Only

## Every Session
1. Read `SOUL.md` — who you are
2. Read `USER.md` — who you're helping
3. Read `memory/YYYY-MM-DD.md` (today + yesterday)
4. **Main session only**: Read `MEMORY.md`

## Memory
- **Daily:** `memory/YYYY-MM-DD.md` — raw logs
- **Long-term:** `MEMORY.md` — curated (main session only)
- **Write it down** — no mental notes, files persist

## Safety
- Don't exfiltrate private data
- `trash` > `rm`
- Ask before destructive commands

## Group Chats
- Respond when: mentioned, add value, or correcting errors
- Stay silent when: casual banter, already answered, would interrupt
- React naturally with emoji (👍 ❤️ 😂 etc.)

## 📰 Morning Report (08:00-08:10 Taipei)
Auto-collect Chris's financial news:
- Text: `exec('cd ~/clawd/agents/market-digest && node morning-collector.js add-text "<content>"')`
- Images: `exec('cd ~/clawd/agents/market-digest && node morning-collector.js add-image <path>')`
- Reply: `✅ 已收集早報（第 N 則）`
- 08:30: Cron integrates & pushes combined report (minimal level)

See: `agents/market-digest/MORNING_INTEGRATION.md`

## 📊 Market Digest Commands

### /today - 查看完整財經報告
When Chris inputs `/today` or `/today full`:
- `/today`: Generate standard report (800 words)
- `/today full`: Generate full report (original text)
- Command: `exec('cd ~/clawd/agents/market-digest && node smart-integrator.js integrate --level <level>')`
- Then: `message send` the report to Chris
- See: `agents/market-digest/TIERED_OUTPUT.md`

### /query - 搜尋歷史早報
When Chris inputs `/query <keyword>` or `/query <keyword> --days <N>`:
- Extract keyword and optional days (default 7)
- Extract optional flags: `--count` (only show count, not content)
- Command: `exec('cd ~/clawd/agents/market-digest && node query.js --keyword "<keyword>" --days <N> [--count]')`
- If result > 4000 chars: show first 10 results + suggest narrowing range
- See: `agents/market-digest/QUERY_TOOL.md`

Examples:
- `/query 沃什` → search "沃什" in last 7 days
- `/query 聯發科 --days 30` → search "聯發科" in last 30 days
- `/query 台股 --count` → count "台股" mentions in last 7 days

### /watchlist - 個股追蹤清單
When Chris inputs `/watchlist <action> [args]`:
- `/watchlist add 2330 2454` → Add stocks to watchlist
- `/watchlist list` → List all tracked stocks
- `/watchlist summary` → Today's summary (from morning report)
- `/watchlist history 2454 --days 14` → Stock history (last 14 days)
- `/watchlist remove 2330` → Remove stock
- Command: `exec('cd ~/clawd/agents/market-digest && node watchlist.js <action> [args]')`
- See: `agents/market-digest/FEATURES_SUMMARY.md`

### Auto-reminders (自動提醒)
- **Daily 20:00**: Check tomorrow's reminders
  - Extracted from morning reports (e.g., "2/3 聯發科法說會")
  - Categorized by priority (high/medium/low)
  - Pushed to Telegram if any reminders found
- **Weekly Friday 20:00**: Weekly summary
  - Major events of the week
  - Top performers (stocks)
  - Watchlist performance
- See: `agents/market-digest/FEATURES_SUMMARY.md`
