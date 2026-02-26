/**
 * safe-write.js — Atomic JSON/Text file writer
 *
 * 寫入策略：write → fsync → close → rename（保證原子性）
 * 同資料夾的 .tmp 檔避免跨裝置 rename 失敗
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 原子寫入 JSON 檔案
 * @param {string} filePath - 目標檔案路徑
 * @param {*} data - 要序列化的資料
 */
function safeWriteJson(filePath, data) {
  const json = JSON.stringify(data, null, 2) + '\n';
  safeWriteText(filePath, json);
}

/**
 * 原子寫入文字檔案
 * @param {string} filePath - 目標檔案路徑
 * @param {string} text - 要寫入的文字
 */
function safeWriteText(filePath, text) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = filePath + '.tmp';
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
}

module.exports = { safeWriteJson, safeWriteText };
