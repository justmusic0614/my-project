'use strict';

/**
 * schema.js — Morning Briefing payload 驗證
 *
 * 是降級鏈的一部分，不是阻斷器：
 * - 單一區塊 fail → 改為 status=error，其餘正常
 * - 整體 payload 無效（缺 generated_at）→ 回傳 { valid: false }
 */

const VALID_STATUSES  = new Set(['ok', 'degraded', 'error']);
const VALID_FRESHNESS = new Set(['fresh', 'stale', 'missing']);
const BLOCK_KEYS      = ['market', 'system', 'knowledge', 'security'];

/**
 * 驗證並修補單一區塊
 * @returns {object} 修補後的區塊
 */
function _validateBlock(block, name) {
  if (!block || typeof block !== 'object') {
    return { status: 'error', reason: `${name}: block missing or not object`, data_freshness: 'missing' };
  }

  const errors = [];

  // status 驗證
  if (!VALID_STATUSES.has(block.status)) {
    errors.push(`invalid status "${block.status}"`);
  }

  // degraded 必須帶 reason
  if (block.status === 'degraded' && !block.reason) {
    errors.push('degraded block missing reason');
  }

  // data_freshness 驗證
  if (!VALID_FRESHNESS.has(block.data_freshness)) {
    errors.push(`invalid data_freshness "${block.data_freshness}"`);
  }

  // stale 必須帶 age_hours
  if (block.data_freshness === 'stale' && (block.age_hours === undefined || block.age_hours === null)) {
    errors.push('stale block missing age_hours');
  }

  if (errors.length === 0) return block;

  // 有錯誤 → 修補為 error 狀態，保留原始資料
  return {
    ...block,
    status:         'error',
    reason:         `schema_validation_failed: ${errors.join('; ')}`,
    data_freshness: VALID_FRESHNESS.has(block.data_freshness) ? block.data_freshness : 'missing',
    _schema_errors: errors,
  };
}

/**
 * 驗證整體 payload
 * @param {object} payload - collectors.collect() 的輸出
 * @returns {{ valid: boolean, payload: object, errors: string[] }}
 */
function validate(payload) {
  const errors = [];

  // 整體 payload 必要欄位
  if (!payload || typeof payload !== 'object') {
    return { valid: false, payload: null, errors: ['payload is not an object'] };
  }
  if (!payload.generated_at) {
    return { valid: false, payload: null, errors: ['missing generated_at'] };
  }

  // 逐區塊驗證
  const fixed = { ...payload };
  for (const key of BLOCK_KEYS) {
    fixed[key] = _validateBlock(payload[key], key);
    if (fixed[key]._schema_errors) {
      errors.push(`${key}: ${fixed[key]._schema_errors.join('; ')}`);
    }
  }

  return { valid: true, payload: fixed, errors };
}

module.exports = { validate };
