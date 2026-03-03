/**
 * http-client.js — 輕量 HTTP client（Node 內建 https）
 *
 * 功能：
 * - fetchText(url, opts) / fetchJSON(url, opts)
 * - 重試 + exponential backoff（預設 3 次）
 * - 雙段 timeout：connect 5s、read 15s
 * - gzip/deflate 自動解壓
 * - 硬性 2MB 上限（超過直接 fail）
 * - 403/429：throw HttpError（含 status, retryAfterSec, headers）
 * - 可選 If-Modified-Since / ETag
 */

'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');
const zlib = require('zlib');

const MAX_RESPONSE_SIZE = 2 * 1024 * 1024; // 2MB
const DEFAULT_CONNECT_TIMEOUT = 5000;
const DEFAULT_READ_TIMEOUT = 15000;
const DEFAULT_RETRIES = 3;
const DEFAULT_USER_AGENT = 'social-digest/1.0';

// 不重試的 HTTP 狀態碼
const NO_RETRY_STATUSES = new Set([400, 401, 403, 404, 405, 410, 422]);

class HttpError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {object} headers — response headers
   */
  constructor(message, status, headers = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.headers = headers;
    this.retryAfterSec = HttpError._parseRetryAfter(headers);
  }

  static _parseRetryAfter(headers) {
    const val = headers['retry-after'];
    if (!val) return null;
    const sec = parseInt(val, 10);
    if (!isNaN(sec)) return sec;
    // HTTP-date format
    const date = new Date(val);
    if (!isNaN(date.getTime())) {
      return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
    }
    return null;
  }
}

class HttpClient {
  constructor(options = {}) {
    this.connectTimeout = options.connectTimeout || DEFAULT_CONNECT_TIMEOUT;
    this.readTimeout = options.readTimeout || DEFAULT_READ_TIMEOUT;
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.userAgent = options.userAgent || DEFAULT_USER_AGENT;
    this.maxResponseSize = options.maxResponseSize || MAX_RESPONSE_SIZE;
  }

  /**
   * 核心 fetch — 回傳 { status, headers, body }
   * @param {string} url
   * @param {object} opts
   * @param {number} [opts.connectTimeout]
   * @param {number} [opts.readTimeout]
   * @param {number} [opts.retries]
   * @param {object} [opts.headers]
   * @param {string} [opts.ifModifiedSince] — If-Modified-Since header
   * @param {string} [opts.etag] — If-None-Match header
   * @returns {Promise<{ status: number, headers: object, body: string }>}
   */
  async fetch(url, opts = {}) {
    const retries = opts.retries ?? this.retries;
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await sleep(backoff);
      }

      try {
        const result = await this._doRequest(url, opts);

        // 304 Not Modified — 回傳空 body
        if (result.status === 304) {
          return { status: 304, headers: result.headers, body: '' };
        }

        // 2xx — 成功
        if (result.status >= 200 && result.status < 300) {
          return result;
        }

        // 403/429 — throw HttpError，不重試
        if (result.status === 403 || result.status === 429) {
          throw new HttpError(
            `HTTP ${result.status} from ${url}`,
            result.status,
            result.headers
          );
        }

        // 其他 4xx — 不重試
        if (NO_RETRY_STATUSES.has(result.status)) {
          throw new HttpError(
            `HTTP ${result.status} from ${url}`,
            result.status,
            result.headers
          );
        }

        // 5xx 或其他 — 可重試
        lastError = new HttpError(
          `HTTP ${result.status} from ${url}`,
          result.status,
          result.headers
        );
      } catch (err) {
        lastError = err;
        // HttpError with no-retry status — 直接拋出
        if (err instanceof HttpError && NO_RETRY_STATUSES.has(err.status)) {
          throw err;
        }
        if (err instanceof HttpError && (err.status === 403 || err.status === 429)) {
          throw err;
        }
        // 網路/timeout 錯誤或 5xx — 繼續重試
      }
    }

    throw lastError;
  }

  /**
   * 取得 text 回應
   * @returns {Promise<string>}
   */
  async fetchText(url, opts = {}) {
    const result = await this.fetch(url, opts);
    return result.body;
  }

  /**
   * 取得 JSON 回應
   * @returns {Promise<object>}
   */
  async fetchJSON(url, opts = {}) {
    const result = await this.fetch(url, opts);
    try {
      return JSON.parse(result.body);
    } catch (err) {
      throw new Error(`JSON parse error from ${url}: ${err.message}`);
    }
  }

  // ── 底層請求 ──────────────────────────────────────────────────────────────

  _doRequest(url, opts) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;
      const connectTimeout = opts.connectTimeout || this.connectTimeout;
      const readTimeout = opts.readTimeout || this.readTimeout;
      const maxSize = this.maxResponseSize;

      const headers = {
        'User-Agent': this.userAgent,
        'Accept-Encoding': 'gzip, deflate',
        ...(opts.headers || {}),
      };

      // 條件式請求
      if (opts.ifModifiedSince) {
        headers['If-Modified-Since'] = opts.ifModifiedSince;
      }
      if (opts.etag) {
        headers['If-None-Match'] = opts.etag;
      }

      const reqOpts = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers,
        timeout: connectTimeout,
      };

      const req = protocol.request(reqOpts, (res) => {
        // 連線成功，切換到 read timeout
        req.setTimeout(readTimeout);

        // 處理 redirect（3xx）
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // 跟隨 redirect（遞迴，最多 3 層）
          const depth = (opts._redirectDepth || 0) + 1;
          if (depth > 3) {
            reject(new Error(`Too many redirects (${depth}) from ${url}`));
            return;
          }
          const redirectUrl = new URL(res.headers.location, url).href;
          this._doRequest(redirectUrl, { ...opts, _redirectDepth: depth })
            .then(resolve)
            .catch(reject);
          // 消耗原始 response 防止 socket 掛住
          res.resume();
          return;
        }

        // 304 — 直接回傳（不讀 body）
        if (res.statusCode === 304) {
          res.resume();
          resolve({ status: 304, headers: res.headers, body: '' });
          return;
        }

        // 選擇解壓 stream
        let stream = res;
        const encoding = (res.headers['content-encoding'] || '').toLowerCase();
        if (encoding === 'gzip') {
          stream = res.pipe(zlib.createGunzip());
        } else if (encoding === 'deflate') {
          stream = res.pipe(zlib.createInflate());
        }

        let totalSize = 0;
        const chunks = [];

        stream.on('data', (chunk) => {
          totalSize += chunk.length;
          if (totalSize > maxSize) {
            req.destroy();
            reject(new Error(`Response size exceeds ${maxSize} bytes limit from ${url}`));
          } else {
            chunks.push(chunk);
          }
        });

        stream.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body,
          });
        });

        stream.on('error', (err) => {
          err.type = 'READ_ERROR';
          reject(err);
        });
      });

      req.on('timeout', () => {
        req.destroy();
        const err = new Error(`Request timeout from ${url}`);
        err.type = 'TIMEOUT';
        reject(err);
      });

      req.on('error', (err) => {
        if (!err.type) err.type = 'NETWORK_ERROR';
        reject(err);
      });

      req.end();
    });
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 單例（由 config 初始化後共用）
let _instance = null;

function createClient(config = {}) {
  _instance = new HttpClient({
    connectTimeout: config.connectTimeout || DEFAULT_CONNECT_TIMEOUT,
    readTimeout: config.readTimeout || DEFAULT_READ_TIMEOUT,
    maxResponseSize: config.maxResponseSize || MAX_RESPONSE_SIZE,
    userAgent: config.userAgent || DEFAULT_USER_AGENT,
  });
  return _instance;
}

function getClient() {
  if (!_instance) {
    _instance = new HttpClient();
  }
  return _instance;
}

module.exports = { HttpClient, HttpError, createClient, getClient };
