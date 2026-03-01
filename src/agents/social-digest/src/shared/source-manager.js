/**
 * source-manager.js — 管理 sources.json（M2）
 *
 * 職責：
 * - 讀取/寫入 data/sources.json
 * - 查詢啟用的群組、公開群組、must_include 群組
 * - 更新群組 weight（含約束：[0.2, 3.0]、24h cooldown）
 */

'use strict';

const fs = require('fs');
const path = require('path');

const WEIGHT_MIN = 0.2;
const WEIGHT_MAX = 3.0;
const COOLDOWN_HOURS = 24;

class SourceManager {
  /**
   * @param {string} sourcesPath — sources.json 的絕對路徑
   */
  constructor(sourcesPath) {
    this.sourcesPath = sourcesPath;
    this._sources = null;
  }

  // ── 讀寫 ──────────────────────────────────────────────────────────────────

  load() {
    const raw = fs.readFileSync(this.sourcesPath, 'utf8');
    this._sources = JSON.parse(raw);
    return this;
  }

  save() {
    fs.writeFileSync(
      this.sourcesPath,
      JSON.stringify(this._sources, null, 2),
      'utf8'
    );
    return this;
  }

  get sources() {
    if (!this._sources) this.load();
    return this._sources;
  }

  // ── 查詢 ──────────────────────────────────────────────────────────────────

  /**
   * 所有啟用的群組（enabled: true）
   */
  getEnabled() {
    return this.sources.filter(s => s.enabled !== false && !s._comment);
  }

  /**
   * 公開群組（可做 L2 fetch）
   */
  getPublicEnabled() {
    return this.getEnabled().filter(s => s.public === true);
  }

  /**
   * must_include 群組
   */
  getMustInclude() {
    return this.getEnabled().filter(s => s.must_include === true);
  }

  /**
   * 以 URL 查詢 source（用於貼文標注）
   */
  findByUrl(url) {
    if (!url) return null;
    const normalized = url.replace(/\/$/, '').toLowerCase();
    return this.sources.find(s => {
      const su = (s.url || '').replace(/\/$/, '').toLowerCase();
      return su === normalized;
    }) || null;
  }

  /**
   * 取得群組的 weight（找不到回傳 1.0）
   */
  getWeight(groupUrl) {
    const s = this.findByUrl(groupUrl);
    return s ? (s.weight ?? 1.0) : 1.0;
  }

  // ── Weight 動態調整 ────────────────────────────────────────────────────────

  /**
   * 調整群組 weight
   * @param {string} groupUrl
   * @param {number} delta — 正或負
   * @returns {{ ok: boolean, reason: string, newWeight: number }}
   */
  adjustWeight(groupUrl, delta) {
    const s = this.findByUrl(groupUrl);
    if (!s) {
      return { ok: false, reason: 'source_not_found', newWeight: null };
    }

    // Cooldown 檢查
    if (s.last_weight_update) {
      const lastUpdate = new Date(s.last_weight_update).getTime();
      const elapsedHours = (Date.now() - lastUpdate) / 3600000;
      if (elapsedHours < COOLDOWN_HOURS) {
        const remainHours = (COOLDOWN_HOURS - elapsedHours).toFixed(1);
        return {
          ok: false,
          reason: 'cooldown',
          newWeight: s.weight,
          remainHours: parseFloat(remainHours),
        };
      }
    }

    const prev = s.weight ?? 1.0;
    const raw = prev + delta;
    const newWeight = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, raw));
    s.weight = Math.round(newWeight * 100) / 100;  // 保留兩位小數
    s.last_weight_update = new Date().toISOString();
    this.save();

    return { ok: true, reason: 'adjusted', prev, newWeight: s.weight };
  }

  /**
   * 批次套用回饋（從 rules.json 取 adjustments）
   * @param {Array<{groupUrl, action}>} feedbacks
   * @param {Object} adjustments — { good, pin, mute }
   */
  applyFeedbacks(feedbacks, adjustments) {
    const results = [];
    for (const fb of feedbacks) {
      const delta = adjustments[fb.action] ?? 0;
      if (delta === 0) continue;
      const r = this.adjustWeight(fb.groupUrl, delta);
      results.push({ ...r, groupUrl: fb.groupUrl, action: fb.action });
    }
    return results;
  }

  // ── 診斷 ──────────────────────────────────────────────────────────────────

  summary() {
    const all = this.sources.filter(s => !s._comment);
    const enabled = this.getEnabled();
    const mustInclude = this.getMustInclude();
    const publicEnabled = this.getPublicEnabled();
    return {
      total: all.length,
      enabled: enabled.length,
      must_include: mustInclude.length,
      public_enabled: publicEnabled.length,
      disabled: all.length - enabled.length,
    };
  }
}

module.exports = { SourceManager };
