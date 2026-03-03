/**
 * github-collector.js — GitHub Releases Collector（Phase 2）
 *
 * 使用 GitHub REST API: GET /repos/{owner}/{repo}/releases
 * src.meta.repo = "langchain-ai/langchain"
 *
 * Rate limit 處理（token/global）：
 *   - X-RateLimit-Remaining < 5 或 403/429 → 把「該 run 所有尚未抓的 github_releases:* source」
 *     全部寫 disabled，until = X-RateLimit-Reset
 *
 * 回傳格式：
 *   { posts, watermark, stats, disabled, recovered }
 */

'use strict';

const { getClient } = require('./http-client');
const { normalizeToPost, makeSourceKey, stripHtml } = require('../processors/web-normalizer');

const COLLECTOR_TYPE_RELEASES = 'github_releases';

/**
 * 收集 GitHub Releases
 * @param {Array} sources — sources.json 中 type=github_releases 的項目
 * @param {object} collectorConfig — config.json collectors.github_releases
 *   { token, maxReleasesPerRepo, safetyWindowMinutes }
 * @param {object} watermarks — web_watermarks map（key: source_key）
 * @param {object} disabledSources — disabled_sources map（key: source_key）
 * @returns {Promise<{ posts, watermark, stats, disabled, recovered }>}
 */
async function collectReleases(sources, collectorConfig, watermarks = {}, disabledSources = {}) {
  const startTime = Date.now();
  const token = collectorConfig.token || '';
  const maxReleasesPerRepo = collectorConfig.maxReleasesPerRepo || 3;
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

  let anySourceOk = false;
  let rateLimitHit = false;

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const sourceKey = makeSourceKey(COLLECTOR_TYPE_RELEASES, src.id);
    const repo = src.meta?.repo;

    if (!repo) {
      stats.source_failures.push({ source_key: sourceKey, reason: 'NO_REPO', detail: 'src.meta.repo is missing' });
      continue;
    }

    // 檢查是否 disabled
    const disabledEntry = disabledSources[sourceKey];
    if (disabledEntry && new Date(disabledEntry.until) > new Date()) {
      stats.skipped_disabled++;
      continue;
    }

    // Rate limit 已觸發 → 把剩餘所有 source 全部 disabled
    if (rateLimitHit) {
      disabled.push({
        source_key: sourceKey,
        until: _getRateLimitResetTime(),
        reason: 'rate_limit_global',
        consecutive: (disabledSources[sourceKey]?.consecutive || 0) + 1,
      });
      continue;
    }

    try {
      const httpClient = getClient();
      const apiUrl = `https://api.github.com/repos/${repo}/releases`;

      const headers = {
        'Accept': 'application/vnd.github.v3+json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await httpClient.fetch(apiUrl, { headers, retries: 1 });

      // 檢查 rate limit 剩餘次數
      const remaining = parseInt(response.headers['x-ratelimit-remaining'] || '999', 10);
      const resetEpoch = parseInt(response.headers['x-ratelimit-reset'] || '0', 10);

      let releases;
      try {
        releases = JSON.parse(response.body);
      } catch (parseErr) {
        throw new Error(`JSON parse error: ${parseErr.message}`);
      }

      if (!Array.isArray(releases)) {
        // GitHub API 可能回傳錯誤物件（如 { message: "Not Found" }）
        const msg = releases?.message || 'Unexpected response';
        throw new Error(`GitHub API error: ${msg}`);
      }

      stats.fetched += releases.length;

      // 時間過濾
      const wm = watermarks[sourceKey];
      let effectiveSince = null;
      if (wm) {
        const wmDate = new Date(wm);
        if (!isNaN(wmDate.getTime())) {
          effectiveSince = new Date(wmDate.getTime() - safetyWindowMinutes * 60 * 1000);
        }
      }

      let filteredCount = 0;
      const parsedItems = [];

      for (const release of releases.slice(0, maxReleasesPerRepo)) {
        stats.parsed++;

        // published_at fallback：published_at → created_at → fetch_time
        const fetchTime = new Date().toISOString();
        const publishedAt = release.published_at || release.created_at || fetchTime;

        // 時間過濾
        if (effectiveSince) {
          const releaseDate = new Date(publishedAt);
          if (!isNaN(releaseDate.getTime()) && releaseDate <= effectiveSince) {
            filteredCount++;
            continue;
          }
        }

        // title：release.name || release.tag_name
        const title = release.name || release.tag_name || `Release ${release.id}`;

        // snippet：release.body（Markdown strip → 500 字）
        const rawBody = release.body || '';
        const snippet = _stripMarkdown(rawBody).slice(0, 500);

        // source_item_key：`${repo}#${release.id}`
        const sourceItemKey = `${repo}#${release.id}`;

        // URL
        const url = release.html_url || null;

        // 建構 item 傳給 normalizeToPost
        const item = {
          title,
          link: url,
          isoDate: publishedAt,
          contentSnippet: snippet,
          guid: sourceItemKey,
        };

        const post = normalizeToPost(item, src, { source_item_key: sourceItemKey });
        parsedItems.push(post);
      }

      stats.filtered += filteredCount;
      allPosts.push(...parsedItems);

      // 成功
      const fetchCompletedAt = new Date().toISOString();
      newWatermark[sourceKey] = fetchCompletedAt;
      anySourceOk = true;
      if (disabledEntry) recovered.push(sourceKey);

      // Rate limit 低警戒（< 5）→ 觸發 rate limit 保護
      if (remaining < 5) {
        rateLimitHit = true;
        const resetTime = resetEpoch
          ? new Date(resetEpoch * 1000).toISOString()
          : new Date(Date.now() + 3600 * 1000).toISOString();

        // 把本 source 之後的所有 source 全部 disabled（此 source 已成功，不 disable 自身）
        for (let j = i + 1; j < sources.length; j++) {
          const futureKey = makeSourceKey(COLLECTOR_TYPE_RELEASES, sources[j].id);
          if (disabledSources[futureKey] && new Date(disabledSources[futureKey].until) > new Date()) {
            continue; // 已 disabled 的跳過
          }
          disabled.push({
            source_key: futureKey,
            until: resetTime,
            reason: 'rate_limit_global',
            consecutive: (disabledSources[futureKey]?.consecutive || 0) + 1,
          });
        }
      }

    } catch (err) {
      // 403/429 → rate limit 或禁止，disable 剩餘所有 source
      if (err.name === 'HttpError' && (err.status === 403 || err.status === 429)) {
        rateLimitHit = true;

        const consecutive = ((disabledSources[sourceKey]?.consecutive) || 0) + 1;
        const resetHeader = err.headers?.['x-ratelimit-reset'];
        let until;

        if (resetHeader) {
          until = new Date(parseInt(resetHeader, 10) * 1000).toISOString();
        } else if (err.status === 429) {
          const retryAfter = err.retryAfterSec || (30 * 60 * Math.pow(2, Math.min(consecutive - 1, 6)));
          until = new Date(Date.now() + retryAfter * 1000).toISOString();
        } else {
          // 403
          let hours = 24;
          if (consecutive >= 3) hours = 72;
          if (consecutive >= 6) hours = 168;
          until = new Date(Date.now() + hours * 3600 * 1000).toISOString();
        }

        // 本 source + 剩餘所有 source 全部 disable
        disabled.push({ source_key: sourceKey, until, reason: String(err.status), consecutive });
        for (let j = i + 1; j < sources.length; j++) {
          const futureKey = makeSourceKey(COLLECTOR_TYPE_RELEASES, sources[j].id);
          if (disabledSources[futureKey] && new Date(disabledSources[futureKey].until) > new Date()) {
            continue;
          }
          disabled.push({
            source_key: futureKey,
            until,
            reason: 'rate_limit_global',
            consecutive: (disabledSources[futureKey]?.consecutive || 0) + 1,
          });
        }
      }

      stats.source_failures.push({
        source_key: sourceKey,
        reason: err.name === 'HttpError' ? `HTTP_${err.status}` : err.type || 'UNKNOWN',
        detail: err.message,
      });
    }
  }

  stats.ok = anySourceOk;
  stats.new = allPosts.length;
  stats.duration_ms = Date.now() - startTime;

  return { posts: allPosts, watermark: newWatermark, stats, disabled, recovered };
}

// ── 工具函式 ─────────────────────────────────────────────────────────────────

function _getRateLimitResetTime() {
  // 沒有 header 資訊時，預設 1 小時後
  return new Date(Date.now() + 3600 * 1000).toISOString();
}

/**
 * 簡單 Markdown 去格式（去掉常見 syntax，留純文字）
 */
function _stripMarkdown(md) {
  if (!md) return '';
  return md
    .replace(/#{1,6}\s+/g, '')          // 標題
    .replace(/\*\*(.+?)\*\*/g, '$1')    // 粗體
    .replace(/\*(.+?)\*/g, '$1')         // 斜體
    .replace(/`{1,3}[^`]*`{1,3}/g, '')  // code
    .replace(/!\[.*?\]\(.*?\)/g, '')     // 圖片
    .replace(/\[(.+?)\]\(.*?\)/g, '$1') // 連結
    .replace(/^\s*[-*+]\s+/gm, '')      // 列點
    .replace(/^\s*\d+\.\s+/gm, '')      // 有序列表
    .replace(/\n{3,}/g, '\n\n')          // 多餘換行
    .trim();
}

module.exports = { collectReleases, COLLECTOR_TYPE_RELEASES };
// collectTrending: 不實作（Phase 3）
