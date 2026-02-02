#!/usr/bin/env node
// Vision Extractor - 使用 AI 提取圖片中的財經新聞內容

const fs = require('fs');
const path = require('path');

/**
 * 從圖片提取新聞標題（批次處理）
 */
async function extractFromImages(imagePaths) {
  const results = [];
  
  console.log(`📸 開始處理 ${imagePaths.length} 張圖片...`);
  
  for (let i = 0; i < imagePaths.length; i++) {
    const imagePath = imagePaths[i];
    console.log(`  處理 ${i + 1}/${imagePaths.length}: ${path.basename(imagePath)}`);
    
    try {
      const extracted = await extractSingleImage(imagePath);
      if (extracted.titles.length > 0) {
        results.push(...extracted.titles);
      }
    } catch (err) {
      console.error(`  ❌ 失敗：${err.message}`);
    }
  }
  
  console.log(`✅ 完成！提取 ${results.length} 條新聞`);
  return results;
}

/**
 * 從單張圖片提取內容（簡化版 - 使用 OCR 模擬）
 */
async function extractSingleImage(imagePath) {
  // 簡化版：從檔案名稱推測內容類型
  // 實際應該調用 vision API，但為了快速測試先用模擬
  
  // 模擬提取的新聞標題（基於我看到的圖片）
  const mockTitles = {
    // 這裡應該是真實的 vision API 調用
    // 目前先返回空，等待真實整合
  };
  
  return {
    titles: [],
    source: path.basename(imagePath)
  };
}

/**
 * 主程式：處理收集的圖片並返回新聞標題
 */
async function processCollectedImages(collectFile) {
  if (!fs.existsSync(collectFile)) {
    return [];
  }
  
  const collected = JSON.parse(fs.readFileSync(collectFile, 'utf8'));
  const imagePaths = collected.images.map(img => img.path);
  
  if (imagePaths.length === 0) {
    return [];
  }
  
  const titles = await extractFromImages(imagePaths);
  return titles;
}

module.exports = { extractFromImages, processCollectedImages };

// CLI 模式
if (require.main === module) {
  const collectFile = process.argv[2] || path.join(__dirname, 'data/morning-collect', `${new Date().toISOString().split('T')[0]}.json`);
  
  processCollectedImages(collectFile).then(titles => {
    console.log('\n提取結果：');
    titles.forEach((title, i) => {
      console.log(`${i + 1}. ${title}`);
    });
  });
}
