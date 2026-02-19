/**
 * PDF 解析器 - NYSE 休市日曆 PDF 專用
 *
 * 使用 pdfjs-dist（純 JS 實作，無 canvas 依賴）
 *
 * 用途：
 * - 下載 NYSE PDF 日曆檔案
 * - 提取純文字內容
 * - 供 holiday-sync.js 進行日期 regex 解析
 *
 * 範例：
 *   const parser = new PDFParser();
 *   const text = await parser.extractText('https://www.nyse.com/.../calendar.pdf');
 */

'use strict';

const { HttpClient } = require('../shared/http-client');
const { createLogger } = require('../shared/logger');

const logger = createLogger('pdf-parser');

class PDFParser {
  constructor(options = {}) {
    this.httpClient = new HttpClient({
      timeout: options.timeout || 30000,
      logger
    });

    // Lazy load pdfjs-dist（避免未安裝時直接 crash）
    this._pdfjs = null;
  }

  /**
   * 載入 pdfjs-dist（延遲初始化）
   */
  _loadPDFJS() {
    if (!this._pdfjs) {
      try {
        // 使用 legacy build（無 canvas 依賴）
        this._pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
        logger.info('✅ pdfjs-dist loaded successfully');
      } catch (err) {
        const error = new Error('pdfjs-dist not installed. Run: npm install pdfjs-dist@2.16.105');
        error.code = 'MISSING_DEPENDENCY';
        error.originalError = err;
        throw error;
      }
    }
    return this._pdfjs;
  }

  /**
   * 從 URL 提取 PDF 純文字
   *
   * @param {string} pdfUrl - PDF 檔案 URL
   * @param {object} options - 選項
   * @param {number} options.maxPages - 最大頁數（預設 20）
   * @returns {Promise<string>} 純文字內容
   */
  async extractText(pdfUrl, options = {}) {
    const maxPages = options.maxPages || 20;

    logger.info(`📄 下載 PDF: ${pdfUrl}`);

    // 1. 下載 PDF 為 Buffer
    const buffer = await this.httpClient.fetchBuffer(pdfUrl);
    logger.info(`✅ PDF 下載完成，大小: ${(buffer.length / 1024).toFixed(1)} KB`);

    // 2. 載入 pdfjs-dist
    const pdfjsLib = this._loadPDFJS();

    // 3. 解析 PDF
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      verbosity: 0  // 關閉 pdfjs 內部日誌
    });

    const pdfDoc = await loadingTask.promise;
    const numPages = Math.min(pdfDoc.numPages, maxPages);

    logger.info(`📖 PDF 總頁數: ${pdfDoc.numPages}，處理頁數: ${numPages}`);

    // 4. 逐頁提取文字
    let fullText = '';

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();

      // textContent.items 包含每個文字片段
      const pageText = textContent.items
        .map(item => item.str)
        .join(' ');

      fullText += pageText + '\n\n';

      logger.debug(`  Page ${pageNum}/${numPages}: ${pageText.length} chars`);
    }

    logger.info(`✅ PDF 文字提取完成，總字元數: ${fullText.length}`);

    return fullText;
  }

  /**
   * 從 Buffer 提取 PDF 純文字（供測試使用）
   *
   * @param {Buffer} buffer - PDF 檔案 Buffer
   * @param {object} options - 選項
   * @returns {Promise<string>} 純文字內容
   */
  async extractTextFromBuffer(buffer, options = {}) {
    const maxPages = options.maxPages || 20;

    logger.info(`📄 解析 PDF Buffer，大小: ${(buffer.length / 1024).toFixed(1)} KB`);

    const pdfjsLib = this._loadPDFJS();

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      verbosity: 0
    });

    const pdfDoc = await loadingTask.promise;
    const numPages = Math.min(pdfDoc.numPages, maxPages);

    let fullText = '';

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();

      const pageText = textContent.items
        .map(item => item.str)
        .join(' ');

      fullText += pageText + '\n\n';
    }

    logger.info(`✅ PDF Buffer 文字提取完成，總字元數: ${fullText.length}`);

    return fullText;
  }

  /**
   * 檢查 pdfjs-dist 是否可用
   */
  static isAvailable() {
    try {
      require.resolve('pdfjs-dist/legacy/build/pdf.js');
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = PDFParser;
