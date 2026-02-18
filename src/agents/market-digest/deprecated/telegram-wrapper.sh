#!/bin/bash
# Telegram Wrapper - Telegram 指令包裝器（D 項目）
# 提供簡潔的 Telegram 輸出格式

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 輸出格式：Telegram 精簡版
# - 移除過多空行
# - 簡化 emoji
# - 保持可讀性

command="$1"
shift

case "$command" in
  # /watchlist list - 列出追蹤清單
  list)
    node watchlist.js list
    ;;
  
  # /watchlist add <代號...> - 新增股票
  add)
    if [ $# -eq 0 ]; then
      echo "❌ 請指定股票代號"
      echo "💡 使用：/watchlist add 2330 2454"
      exit 1
    fi
    node watchlist.js add "$@"
    ;;
  
  # /watchlist remove <代號...> - 移除股票
  remove)
    if [ $# -eq 0 ]; then
      echo "❌ 請指定股票代號"
      echo "💡 使用：/watchlist remove 2330"
      exit 1
    fi
    node watchlist.js remove "$@"
    ;;
  
  # /financial - 日報（財報+籌碼+分析）
  financial)
    node watchlist.js financial 2>&1 | grep -v "正在抓取" | grep -v "使用快取" | grep -v "找不到季度財報" | grep -v "處理"
    ;;
  
  # /weekly [days] - 週報
  weekly)
    days="${1:-5}"
    node watchlist.js weekly --days "$days" 2>&1 | grep -v "正在抓取" | grep -v "使用快取" | grep -v "找不到季度財報" | grep -v "正在生成"
    ;;
  
  # /analyze <代號> - 單檔分析
  analyze)
    if [ $# -eq 0 ]; then
      echo "❌ 請指定股票代號"
      echo "💡 使用：/analyze 2330"
      exit 1
    fi
    code="$1"
    node chip-analyzer.js analyze "$code" 2>&1 | grep -v "正在抓取" | grep -v "使用快取"
    ;;
  
  # /query <關鍵字> [--days N] - 搜尋早報
  query)
    if [ $# -eq 0 ]; then
      echo "❌ 請指定關鍵字"
      echo "💡 使用：/query 台積電"
      exit 1
    fi
    node query.js "$@"
    ;;
  
  # /alerts - 檢查異常提醒
  alerts)
    node alert-monitor.js monitor 2>&1 | grep -v "正在抓取" | grep -v "使用快取" | grep -v "正在監控" | grep -v "檢查"
    ;;
  
  # /news - 今日財經新聞
  news)
    if [ $# -eq 0 ]; then
      node news-viewer.js today
    else
      # /news <關鍵字> - 搜尋
      node news-viewer.js search "$@"
    fi
    ;;
  
  # /突發 - 最近 24 小時重大事件
  breaking)
    node news-viewer.js breaking
    ;;
  
  # news-critical - Critical 新聞（內部推播用）
  news-critical)
    node news-viewer.js critical
    ;;
  
  # news-evening - 盤後摘要（內部推播用）
  news-evening)
    node news-viewer.js evening
    ;;
  
  # 幫助訊息
  help)
    cat <<EOF
📊 Market Digest - Telegram 指令

📋 Watchlist 管理
  /watchlist list              列出追蹤清單
  /watchlist add <代號...>     新增股票
  /watchlist remove <代號...>  移除股票

📈 報告查詢
  /financial                   日報（財報+籌碼+分析）
  /weekly [days]               週報（預設 5 日）
  /analyze <代號>              單檔深度分析

📰 財經新聞
  /news                        今日所有新聞
  /news <關鍵字>               搜尋特定關鍵字
  /突發                        最近 24 小時重大事件

🔍 早報搜尋
  /query <關鍵字> [--days N]   搜尋早報（預設 7 天）

⚠️  智慧提醒
  /alerts                      檢查異常提醒

💡 範例
  /watchlist add 2330 2454
  /financial
  /weekly 7
  /analyze 2330
  /news
  /news 台積電
  /突發
  /query 聯發科 --days 30
  /alerts
EOF
    ;;
  
  *)
    echo "❌ 未知指令：$command"
    echo "💡 使用：/help 查看可用指令"
    exit 1
    ;;
esac
