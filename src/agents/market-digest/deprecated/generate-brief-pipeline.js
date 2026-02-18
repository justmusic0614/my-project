#!/usr/bin/env node
/**
 * Daily Brief Pipeline
 * 完整流程：搜集新聞 → AI 分析 → 生成 Daily Brief（含 Digest Top5）
 */

const path = require("path");
const fs = require("fs").promises;

const NewsCollector = require("./news-collector");
const NewsAnalyzer = require("./news-analyzer");
const DailyBriefGenerator = require("./daily-brief-generator");

async function main() {
  console.log("🚀 啟動 Daily Brief Pipeline...\n");

  try {
    // Step 1: 搜集新聞
    console.log("📡 Step 1: 搜集新聞");
    const collector = new NewsCollector({
      symbols: ["TSMC", "^TWII", "^GSPC", "NVDA", "AAPL", "MSFT"],
      keywords: ["台積電", "聯發科", "AI", "Fed", "降息", "非農", "台股", "美股"]
    });

    const news = await collector.collectAll();
    if (news.length === 0) {
      console.log("⚠️  沒有搜集到新聞");
      process.exit(1);
    }

    await collector.saveToFile(news);
    console.log(`✅ 搜集完成：${news.length} 則新聞\n`);

    // Step 1.5: Digest CLI
    console.log("🧠 Step 1.5: 執行 Digest CLI（摘要新聞）");
    const { execSync } = require("child_process");
    execSync(
      "DIGEST_OUTPUT_DIR=./data/digest/output DIGEST_EXAMPLES_DIR=./data/digest/examples node /home/clawbot/projects/my-project/src/main/js/index.js digest run",
      { stdio: "inherit" }
    );
    console.log("✅ Digest 完成\n");

    // Step 2: AI 分析
    console.log("🔬 Step 2: AI 分析新聞");
    const analyzer = new NewsAnalyzer();
    const analyzed = await analyzer.analyzeAll(news);
    const important = analyzer.filterByImportance(analyzed, 7);
    await analyzer.saveToFile(important);
    console.log(`✅ 分析完成：${important.length} 則重要新聞\n`);

    // Step 3: Daily Brief
    console.log("📊 Step 3: 生成 Daily Brief");
    const generator = new DailyBriefGenerator();
    const brief = await generator.generate();

    // ===== Digest Top5 integration =====
    let digestMd = "";
    try {
      digestMd = await fs.readFile(
        path.join(__dirname, "data/digest/output/brief.md"),
        "utf8"
      );
    } catch (e) {
      digestMd = "";
    }

    const finalBrief =
      digestMd && digestMd.trim()
        ? `${brief}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 Digest_Top5（快速摘要）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${digestMd.trim()}
`
        : brief;

    await generator.saveToFile(finalBrief);

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📄 Daily Brief 預覽：");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    console.log(finalBrief.substring(0, 1000) + "...\n");

    console.log("🎉 Pipeline 執行完成！");
  } catch (error) {
    console.error("❌ Pipeline 執行失敗:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
