// Market Regime Templates - 只能使用預設模板
class RegimeTemplates {
  constructor() {
    this.templates = [
      '中期趨勢偏多，但短線波動上升，事件驅動性提高',
      '市場偏防禦，資金轉向避險資產，波動度上升',
      '市場進入區間震盪，等待關鍵事件與數據指引',
      '風險偏好回升，但對政策/通膨不確定性仍高'
    ];
  }

  select(marketData, narrativeStates) {
    // 簡單規則選擇模板
    const us = marketData.us_stock;
    const tw = marketData.tw_stock;
    const fx = marketData.fx;

    // 規則 1：美股 > 1% → template 0
    if (us && us.sp500_change_pct > 1) {
      return this.templates[0];
    }

    // 規則 2：美股 < -1% 或 VIX 提及 → template 1
    if ((us && us.sp500_change_pct < -1) || 
        (narrativeStates.macro_theme && narrativeStates.macro_theme.includes('避險'))) {
      return this.templates[1];
    }

    // 規則 3：美股 -0.5% ~ 0.5% 小幅波動 → template 2
    if (us && Math.abs(us.sp500_change_pct) < 0.5) {
      return this.templates[2];
    }

    // 規則 4：其他情況（政策不確定性）→ template 3
    return this.templates[3];
  }
}

module.exports = RegimeTemplates;
