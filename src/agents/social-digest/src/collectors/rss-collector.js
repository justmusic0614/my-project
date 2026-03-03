/**
 * rss-collector.js — RSS Collector（Phase 2）
 *
 * 對齊 hn-collector.js 架構，支援：
 * - 兩層 feed_cache：run-level Map + persist ETag/Last-Modified
 * - effectiveSince = max(watermark - safetyWindowMinutes, now - maxAgeHours)
 * - Podcast 特殊處理（isPodcast=true：snippet 取 itunes.summary）
 * - source_item_key：link（canonicalize）→ guid → title:isoDate
 * - 403/429 backoff（完全複製 hn-collector catch 區塊）
 * - httpClient.fetch() 取 ETag/Last-Modified response headers
 *
 * 回傳格式：
 *   { posts, watermark, feedCacheUpdates, stats, disabled, recovered }
 *   feedCacheUpdates: { "rss:sourceId": { etag, lastModified } }
 */

'use strict';

const RssParser = require('rss-parser');
const { getClient } = require('./http-client');
const { normalizeToPost, makeSourceKey, canonicalizeUrl } = require('../processors/web-normalizer');

const COLLECTOR_TYPE = 'rss';

// run-level cache：避免同一 run 重複抓相同 URL
// collect() 開頭清空
const _runCache = new Map();

/**
 * 收集 RSS feeds
 * @param {Array} sources — sources.json 中 type=rss 的項目
 * @param {object} collectorConfig — config.json collectors.rss
 *   { maxItemsPerFeed, maxAgeHours, safetyWindowMinutes, concurrency }
 * @param {object} watermarks — web_watermarks map（key: source_key）
 * @param {object} disabledSources — disabled_sources map（key: source_key）
 * @param {object} prevFeedCache — latest.json.feed_cache（key: "rss:sourceId"）
 * @returns {Promise<{ posts, watermark, feedCacheUpdates, stats, disabled, recovered }>}
 */
async function collect(sources, collectorConfig, watermarks = {}, disabledSources = {}, prevFeedCache = {}) {
  _runCache.clear();

  const startTime = Date.now();
  const maxItemsPerFeed = collectorConfig.maxItemsPerFeed || 20;
  const maxAgeHours = collectorConfig.maxAgeHours || 336;
  const safetyWindowMinutes = collectorConfig.safetyWindowMinutes || 180;
  const concurrency = collectorConfig.concurrency || 3;

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
  const feedCacheUpdates = {};
  const disabled = [];
  const recovered = [];

  const parser = new RssParser({
    timeout: 15000,
    headers: { 'User-Agent': 'social-digest/1.0' },
    customFields: {
      item: [
        ['itunes:summary', 'itunesSummary'],
        ['itunes:duration', 'itunesDuration'],
        ['media:content', 'mediaContent'],
      ],
    },
  });

  let anySourceOk = false;

  // concurrency 控制：自行 chunk（不引入 p-limit）
  for (let i = 0; i < sources.length; i += concurrency) {
    const chunk = sources.slice(i, i + concurrency);
    await Promise.all(chunk.map(src => _processSource(src)));
  }

  stats.ok = anySourceOk;
  stats.new = allPosts.length;
  stats.duration_ms = Date.now() - startTime;

  return { posts: allPosts, watermark: newWatermark, feedCacheUpdates, stats, disabled, recovered };

  // ── 處理單一 source ──────────────────────────────────────────────────────

  async function _processSource(src) {
    const sourceKey = makeSourceKey(COLLECTOR_TYPE, src.id);
    const feedCacheKey = 'rss:' + src.id; // 硬編碼前綴，不用 makeSourceKey

    // 檢查是否 disabled
    const disabledEntry = disabledSources[sourceKey];
    if (disabledEntry && new Date(disabledEntry.until) > new Date()) {
      stats.skipped_disabled++;
      return;
    }

    try {
      const httpClient = getClient();

      // 準備 conditional request headers
      const cached = prevFeedCache[feedCacheKey] || {};
      const fetchOpts = {};
      if (cached.etag) fetchOpts.etag = cached.etag;
      if (cached.lastModified) fetchOpts.ifModifiedSince = cached.lastModified;

      // 呼叫 fetch()（非 fetchText），以取得 response headers
      let feedText;
      let responseHeaders;

      // run-level cache：同一 URL 不重複抓
      if (_runCache.has(src.url)) {
        const cached_ = _runCache.get(src.url);
        feedText = cached_.feedText;
        responseHeaders = cached_.headers;
      } else {
        const response = await httpClient.fetch(src.url, fetchOpts);

        if (response.status === 304) {
          // 304 Not Modified：視為成功，更新 watermark，但不更新 feedCacheUpdates
          const fetchCompletedAt = new Date().toISOString();
          newWatermark[sourceKey] = fetchCompletedAt;
          anySourceOk = true;
          if (disabledEntry) recovered.push(sourceKey);
          _runCache.set(src.url, { feedText: null, headers: response.headers, is304: true });
          return;
        }

        feedText = response.body;
        responseHeaders = response.headers;
        _runCache.set(src.url, { feedText, headers: responseHeaders, is304: false });

        // 更新 feed_cache（ETag / Last-Modified）
        const newEtag = responseHeaders['etag'];
        const newLastModified = responseHeaders['last-modified'];
        if (newEtag || newLastModified) {
          feedCacheUpdates[feedCacheKey] = {
            etag: newEtag || cached.etag || null,
            lastModified: newLastModified || cached.lastModified || null,
          };
        }
      }

      if (!feedText) {
        // 304 from run-level cache，已在上面處理
        const fetchCompletedAt = new Date().toISOString();
        newWatermark[sourceKey] = fetchCompletedAt;
        anySourceOk = true;
        return;
      }

      const feed = await parser.parseString(feedText);
      const items = feed.items || [];
      stats.fetched += items.length;

      // effectiveSince 計算
      const now = new Date();
      const maxAgeCutoff = new Date(now.getTime() - maxAgeHours * 3600 * 1000);
      const wm = watermarks[sourceKey];
      let effectiveSince;

      if (wm) {
        const wmDate = new Date(wm);
        if (!isNaN(wmDate.getTime())) {
          // max(watermark - safetyWindowMinutes, now - maxAgeHours)
          // 取「更近的時間」= 更嚴格的截止點
          const wmCutoff = new Date(wmDate.getTime() - safetyWindowMinutes * 60 * 1000);
          effectiveSince = wmCutoff > maxAgeCutoff ? wmCutoff : maxAgeCutoff;
        } else {
          effectiveSince = maxAgeCutoff;
        }
      } else {
        effectiveSince = maxAgeCutoff;
      }

      let filteredCount = 0;
      const parsedItems = [];

      for (const item of items.slice(0, maxItemsPerFeed)) {
        stats.parsed++;

        // source_item_key：link（canonicalize 相對路徑）→ guid → title:isoDate
        let sourceItemKey;
        if (item.link) {
          // 相對路徑 canonicalize（resolve 至 feed baseUrl）
          let resolvedLink = item.link;
          if (item.link.startsWith('/') && feed.link) {
            try {
              const { URL: NodeURL } = require('url');
              resolvedLink = new NodeURL(item.link, feed.link).href;
            } catch {
              resolvedLink = item.link;
            }
          }
          sourceItemKey = canonicalizeUrl(resolvedLink) || resolvedLink;
        } else if (item.guid) {
          sourceItemKey = item.guid;
        } else {
          sourceItemKey = `${item.title || ''}:${item.isoDate || ''}`;
        }

        // 時間過濾
        const itemDate = item.isoDate ? new Date(item.isoDate) : null;
        if (itemDate && itemDate <= effectiveSince) {
          filteredCount++;
          continue;
        }

        // Podcast 特殊處理：snippet 取 itunes.summary
        const rawItem = { ...item };
        if (src.isPodcast) {
          rawItem.contentSnippet = item.itunesSummary || item.contentSnippet || '';
        }

        const post = normalizeToPost(rawItem, src, { source_item_key: sourceItemKey });
        parsedItems.push(post);
      }

      stats.filtered += filteredCount;
      allPosts.push(...parsedItems);

      // 成功：更新 watermark
      const fetchCompletedAt = new Date().toISOString();
      newWatermark[sourceKey] = fetchCompletedAt;
      anySourceOk = true;

      if (disabledEntry) recovered.push(sourceKey);

    } catch (err) {
      // 403/429 → disabled（完全複製 hn-collector 的 catch 區塊）
      if (err.name === 'HttpError' && (err.status === 403 || err.status === 429)) {
        const consecutive = ((disabledSources[sourceKey]?.consecutive) || 0) + 1;
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
}

module.exports = { collect, COLLECTOR_TYPE };
