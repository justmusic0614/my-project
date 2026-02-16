const fs = require("fs");

function extractDigestSignal(path) {
  try {
    const md = fs.readFileSync(path, "utf8");

    const keywords = ["AI", "台積電", "Fed", "CPI", "通膨", "降息", "美股"];
    const score = {};

    keywords.forEach(k => {
      score[k] = (md.match(new RegExp(k, "g")) || []).length;
    });

    const dominant = Object.entries(score)
      .sort((a, b) => b[1] - a[1])[0][0];

    return {
      dominantTheme: dominant,
      rawScore: score
    };
  } catch {
    return { dominantTheme: null, rawScore: {} };
  }
}

module.exports = { extractDigestSignal };
