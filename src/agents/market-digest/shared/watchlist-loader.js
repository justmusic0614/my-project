'use strict';

const fs = require('fs');

/**
 * 統一 Watchlist 讀取器（Single Source of Truth）
 *
 * 支持三種歷史格式向下相容：
 *   1. 新格式（純 array）:      [{symbol, name, addedAt}]
 *   2. 舊格式 A（object.watchlist）: {watchlist: [{symbol, name}]}
 *   3. 舊格式 B（object.stocks）:    {stocks: [{code, name}]}
 *
 * 正規化輸出：統一為 {symbol, name, addedAt}
 * 自動遷移：cmd-watchlist._save() 寫入 array 格式，下次讀取即為新格式
 */
function loadWatchlist(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    let items;
    if (Array.isArray(data))                items = data;
    else if (Array.isArray(data.watchlist)) items = data.watchlist;
    else if (Array.isArray(data.stocks))    items = data.stocks;
    else return [];

    return items
      .map(item => ({
        symbol:  item.symbol || item.code || '',
        name:    item.name   || '',
        addedAt: item.addedAt || null
      }))
      .filter(item => item.symbol);
  } catch {
    return [];
  }
}

module.exports = { loadWatchlist };
