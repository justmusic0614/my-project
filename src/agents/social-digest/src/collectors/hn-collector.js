/**
 * hn-collector.js — Hacker News Collector（Phase 1）
 *
 * 使用 hnrss.org RSS feed（合規公開服務）。
 * 每個 source 是一個 hnrss.org feed URL（在 sources.json 中定義）。
 *
 * 回傳格式（統一）：
 *   { posts, watermark, stats, disabled, recovered }
 */

'use strict';

const RssParser = require('rss-parser');
const { getClient } = require('./http-client');
const { normalizeToPost, makeSourceKey } = require('../processors/web-normalizer');

const COLLECTOR_TYPE = 'hackernews';

/**
 * 收集 Hacker News 貼文
 * @param {Array} sources — sources.json 中 type=hackernews 的項目
 * @param {object} collectorConfig — config.json collectors.hackernews
 * @param {object} watermarks — web_watermarks map（key: source_key）
 * @param {object} disabledSources — disabled_sources map（key: source_key）
 * @returns {Promise<{ posts, watermark, stats, disabled, recovered }>}
 */
async function collect(sources, collectorConfig, watermarks = {}, disabledSources = {}) {
  const startTime = Date.now();
  const maxItems = collectorConfig.maxItems || 30;
  const safetyWindowMinutes = collectorConfig.safetyWindowMinutes || 180;

  const stats = {
    ok: false,
    fetched: 0,
    parsed: 0,
    filtered: 0,
    new: 0,
    skipped_disabled: 0,
    errors: [],
    source_failures: [],
    duration_ms: 0,
  };

  const allPosts = [];
  const newWatermark = {};
  const disabled = [];
  const recovered = [];

  const parser = new RssParser({
    timeout: 15000,
    headers: { 'User-Agent': 'social-digest/1.0' },
  });

  let anySourceOk = false;

  for (const src of sources) {
    const sourceKey = makeSourceKey(COLLECTOR_TYPE, src.id);

    // 檢查是否 disabled
    const disabledEntry = disabledSources[sourceKey];
    if (disabledEntry && new Date(disabledEntry.until) > new Date()) {
      stats.skipped_disabled++;
      continue;
    }

    try {
      // 抓取 RSS feed
      const httpClient = getClient();
      const feedText = await httpClient.fetchText(src.url, { readTimeout: 15000 });

      const feed = await parser.parseString(feedText);
      const items = feed.items || [];
      stats.fetched += items.length;

      // 時間過濾：effective_since = watermark - safetyWindowMinutes
      const wm = watermarks[sourceKey];
      const effectiveSince = wm
        ? new Date(new Date(wm).getTime() - safetyWindowMinutes * 60 * 1000)
        : null;

      let filteredCount = 0;
      const parsedItems = [];

      for (const item of items.slice(0, maxItems)) {
        stats.parsed++;

        // source_item_key：HN 用 guid → link
        const sourceItemKey = item.guid || item.link;

        // 時間過濾
        const itemDate = item.isoDate ? new Date(item.isoDate) : null;
        if (effectiveSince && itemDate && itemDate <= effectiveSince) {
          filteredCount++;
          continue;
        }
        // published_at 解析失敗 → 不做時間過濾，靠 dedup 兜底

        const post = normalizeToPost(item, src, { source_item_key: sourceItemKey });
        parsedItems.push(post);
      }

      stats.filtered += filteredCount;
      allPosts.push(...parsedItems);

      // 成功：更新 watermark + 記錄 recovered
      const fetchCompletedAt = new Date().toISOString();
      newWatermark[sourceKey] = fetchCompletedAt;
      anySourceOk = true;

      // 如果之前 disabled，現在成功了 → recovered
      if (disabledEntry) {
        recovered.push(sourceKey);
      }

    } catch (err) {
      // 403/429 → disabled
      if (err.name === 'HttpError' && (err.status === 403 || err.status === 429)) {
        const consecutive = ((disabledEntry?.consecutive) || 0) + 1;
        let until;

        if (err.status === 429) {
          const retryAfter = err.retryAfterSec || (30 * 60 * Math.pow(2, Math.min(consecutive - 1, 6)));
          until = new Date(Date.now() + retryAfter * 1000).toISOString();
        } else {
          // 403
          let hours = 24;
          if (consecutive >= 3) hours = 72;
          if (consecutive >= 6) hours = 168; // 7d 上限
          until = new Date(Date.now() + hours * 3600 * 1000).toISOString();
        }

        disabled.push({
          source_key: sourceKey,
          until,
          reason: String(err.status),
          consecutive,
        });
      }

      stats.source_failures.push({
        source_key: sourceKey,
        reason: err.name === 'HttpError' ? `HTTP_${err.status}` : err.type || 'UNKNOWN',
        detail: err.message,
      });
    }
  }

  stats.ok = anySourceOk;
  stats.new = allPosts.length; // dedup 前的 "new"，真正的 dedup 在 agent.js 層
  stats.duration_ms = Date.now() - startTime;

  return { posts: allPosts, watermark: newWatermark, stats, disabled, recovered };
}

module.exports = { collect, COLLECTOR_TYPE };
