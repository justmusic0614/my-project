/**
 * safe-read.js — Safe JSON file reader
 *
 * 規則：
 * - 永遠只讀 filePath 本身，絕不讀 filePath + '.tmp'
 * - .tmp 存在 → logger.warn（前次寫入可能中斷）
 * - parse 失敗行為依呼叫方式不同
 */

'use strict';

const fs = require('fs');
const { createLogger } = require('./logger');

const logger = createLogger('safe-read');

/**
 * 讀取 JSON 檔案（parse 失敗 → throw）
 * @param {string} filePath - 檔案路徑
 * @returns {*} 解析後的 JSON 資料
 */
function safeReadJson(filePath) {
  _warnIfTmpExists(filePath);

  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

/**
 * 讀取 JSON 檔案（檔案不存在或 parse 失敗 → null）
 * @param {string} filePath - 檔案路徑
 * @returns {*|null} 解析後的 JSON 資料，或 null
 */
function safeReadJsonOrNull(filePath) {
  _warnIfTmpExists(filePath);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    logger.warn(`Failed to read/parse ${filePath}: ${err.message}`);
    return null;
  }
}

/**
 * 檢查 .tmp 檔是否殘留（前次寫入可能中斷）
 */
function _warnIfTmpExists(filePath) {
  const tmpPath = filePath + '.tmp';
  if (fs.existsSync(tmpPath)) {
    logger.warn(`tmp file exists: ${tmpPath}; previous write may have been interrupted`);
  }
}

module.exports = { safeReadJson, safeReadJsonOrNull };
