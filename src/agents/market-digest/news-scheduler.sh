#!/bin/bash
# 新聞搜集排程器

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 日誌函數
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

case "$1" in
  morning)
    # 08:30 Taipei - 早報補充
    log "🌅 執行早報補充（08:30 Taipei）"
    
    # 搜集新聞（AI 評分 >= 8）
    log "📡 搜集新聞（min score 8）..."
    node news-collector.js
    
    # 分析（啟用去重）
    log "🔬 分析新聞..."
    node news-analyzer.js
    
    # 整合到 Daily Brief
    log "📊 整合 Daily Brief..."
    node integrate-daily-brief-with-news.js --mode supplement
    
    log "✅ 早報補充完成"
    ;;
  
  midday)
    # 12:00 Taipei - 午盤搜集（僅存檔）
    log "🕐 執行午盤搜集（12:00 Taipei）"
    
    # 搜集新聞（min score 7）
    log "📡 搜集新聞（僅存檔，不推播）..."
    node news-collector.js
    
    # 分析
    log "🔬 分析新聞..."
    node news-analyzer.js
    
    log "✅ 午盤搜集完成（已存檔）"
    ;;
  
  evening)
    # 20:00 Taipei - 盤後搜集
    log "🌆 執行盤後搜集（20:00 Taipei）"
    
    # 搜集新聞（min score 7）
    log "📡 搜集新聞..."
    node news-collector.js
    
    # 分析
    log "🔬 分析新聞..."
    node news-analyzer.js
    
    # 提取明日事件
    log "📅 提取明日關鍵事件..."
    node reminder-extractor.js
    
    # 推播重點摘要
    log "📤 推播盤後摘要..."
    bash telegram-wrapper.sh news-evening
    
    log "✅ 盤後搜集完成"
    ;;
  
  push-critical)
    # 立即推播 Critical 新聞
    log "🚨 推播 Critical 新聞"
    
    bash telegram-wrapper.sh news-critical
    
    log "✅ Critical 推播完成"
    ;;
  
  *)
    echo "Usage: $0 {morning|midday|evening|push-critical}"
    echo ""
    echo "排程說明："
    echo "  morning      08:30 Taipei - 早報補充（搜集 + 分析 + 整合）"
    echo "  midday       12:00 Taipei - 午盤搜集（僅存檔，不推播）"
    echo "  evening      20:00 Taipei - 盤後搜集（搜集 + 分析 + 推播）"
    echo "  push-critical         - 立即推播 Critical 新聞"
    exit 1
    ;;
esac
