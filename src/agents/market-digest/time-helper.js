/**
 * Time Helper - 處理交易日時間邏輯
 */

/**
 * 判斷是否應使用前一交易日數據
 * 規則：台股收盤前（< 15:00 Taipei），查詢當天數據時應使用前一日
 */
function shouldUsePreviousTradingDay(queryDate = null) {
  const now = new Date();
  const taipeiTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  
  // 如果查詢日期不是今天，直接返回 false
  if (queryDate) {
    const today = taipeiTime.toISOString().split('T')[0];
    if (queryDate !== today) {
      return false;
    }
  }
  
  // 檢查當前 Taipei 時間
  const hour = taipeiTime.getHours();
  const minute = taipeiTime.getMinutes();
  
  // 15:00 前使用前一日數據
  if (hour < 15) {
    return true;
  }
  
  // 15:00-16:00 之間可能數據還沒更新，但我們嘗試使用當天
  return false;
}

/**
 * 取得應查詢的日期（考慮時間因素）
 */
function getEffectiveQueryDate(targetDate = null) {
  if (!targetDate) {
    targetDate = new Date().toISOString().split('T')[0];
  }
  
  if (shouldUsePreviousTradingDay(targetDate)) {
    // 往前推一天
    const date = new Date(targetDate);
    date.setDate(date.getDate() - 1);
    return date.toISOString().split('T')[0];
  }
  
  return targetDate;
}

/**
 * 取得數據狀態說明
 */
function getDataStatusMessage(targetDate, actualDataDate) {
  if (targetDate === actualDataDate) {
    return null; // 正常情況，不需要額外說明
  }
  
  const now = new Date();
  const taipeiTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const hour = taipeiTime.getHours();
  
  if (hour < 15) {
    return `📅 盤中報告（使用前一交易日數據：${actualDataDate}）`;
  } else {
    return `📅 使用前一交易日數據（${actualDataDate}，當日數據尚未更新）`;
  }
}

/**
 * 判斷是否為休市日（根據 API 回應）
 */
function isMarketClosed(queryDate, attemptedDates = []) {
  // 如果連續嘗試多個日期都沒數據，才判定為休市
  return attemptedDates.length >= 3;
}

module.exports = {
  shouldUsePreviousTradingDay,
  getEffectiveQueryDate,
  getDataStatusMessage,
  isMarketClosed
};
