const { extractDigestSignal } = require("./digest-signal");

function getDigestImpact(path = "data/digest/output/brief.md") {
  const { dominantTheme, rawScore } = extractDigestSignal(path);

  let impact = "中性";

  if (dominantTheme === "AI" && rawScore.AI >= 2) {
    impact = "結構性偏多（AI 主軸）";
  } else if (dominantTheme === "Fed" || dominantTheme === "CPI") {
    impact = "政策／總經主導（波動升溫）";
  } else if (dominantTheme === "台積電") {
    impact = "權值股影響盤勢";
  }

  return {
    dominantTheme,
    impact,
    rawScore
  };
}

module.exports = { getDigestImpact };
