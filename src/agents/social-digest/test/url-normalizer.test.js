/**
 * url-normalizer.test.js — M5 Unit Tests
 * 執行：node --test test/url-normalizer.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { normalize, sha256, extractPostId, extractGroupUrl, isFbGroupPost, process } = require('../src/processors/url-normalizer');

// ── normalize() ───────────────────────────────────────────────────────────────

describe('normalize()', () => {
  test('去掉 fbclid tracking param', () => {
    const url = 'https://www.facebook.com/groups/123/permalink/456?fbclid=abc&story_fbid=456';
    const result = normalize(url);
    assert.ok(!result.includes('fbclid'), '應移除 fbclid');
    assert.ok(result.includes('story_fbid=456'), '應保留 story_fbid');
  });

  test('去掉 __tn__ / __cft__ / ref tracking params', () => {
    const url = 'https://www.facebook.com/groups/123/permalink/456?__tn__=%2CO&__cft__[0]=xyz&ref=nf';
    const result = normalize(url);
    assert.ok(!result.includes('__tn__'), '應移除 __tn__');
    assert.ok(!result.includes('__cft__'), '應移除 __cft__');
    assert.ok(!result.includes('ref='), '應移除 ref');
  });

  test('m.facebook.com → www.facebook.com', () => {
    const url = 'https://m.facebook.com/groups/123/permalink/456';
    const result = normalize(url);
    assert.ok(result.includes('www.facebook.com'), '應替換為 www.facebook.com');
    assert.ok(!result.includes('m.facebook.com'), '不應含 m.facebook.com');
  });

  test('web.facebook.com → www.facebook.com', () => {
    const url = 'https://web.facebook.com/groups/789/permalink/101?_rdc=1&_rdr';
    const result = normalize(url);
    assert.ok(result.startsWith('https://www.facebook.com'), '應替換為 www.facebook.com');
  });

  test('l.facebook.com redirect → decode 真正 URL', () => {
    const realUrl = 'https://www.facebook.com/groups/123/permalink/456';
    const redirectUrl = `https://l.facebook.com/l.php?u=${encodeURIComponent(realUrl)}&h=abc`;
    const result = normalize(redirectUrl);
    assert.equal(result, realUrl);
  });

  test('去尾端斜線', () => {
    const url = 'https://www.facebook.com/groups/123/permalink/456/';
    const result = normalize(url);
    assert.ok(!result.endsWith('/'), '不應有尾端斜線');
  });

  test('去 fragment (#)', () => {
    const url = 'https://www.facebook.com/groups/123#section';
    const result = normalize(url);
    assert.ok(!result.includes('#'), '不應含 fragment');
  });

  test('http → https', () => {
    const url = 'http://www.facebook.com/groups/123/permalink/456';
    const result = normalize(url);
    assert.ok(result.startsWith('https://'), '應升級為 https');
  });

  test('無效 URL 回傳 null', () => {
    assert.equal(normalize(''), null);
    assert.equal(normalize(null), null);
    // 含空白/控制字元的真正無效 URL
    assert.equal(normalize('ht tp://invalid url with spaces'), null);
  });

  test('相同邏輯 URL 正規化後相同', () => {
    const a = normalize('https://m.facebook.com/groups/123/permalink/456?fbclid=abc&ref=nf');
    const b = normalize('https://www.facebook.com/groups/123/permalink/456');
    assert.equal(a, b, '兩個邏輯相同的 URL 應產出相同 canonical');
  });
});

// ── sha256() ──────────────────────────────────────────────────────────────────

describe('sha256()', () => {
  test('相同字串產生相同 hash', () => {
    const url = 'https://www.facebook.com/groups/123/permalink/456';
    assert.equal(sha256(url), sha256(url));
  });

  test('不同 URL 產生不同 hash', () => {
    const a = sha256('https://www.facebook.com/groups/123/permalink/456');
    const b = sha256('https://www.facebook.com/groups/123/permalink/789');
    assert.notEqual(a, b);
  });

  test('回傳 64 字元 hex', () => {
    const hash = sha256('https://www.facebook.com/groups/123');
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]+$/);
  });
});

// ── extractPostId() ───────────────────────────────────────────────────────────

describe('extractPostId()', () => {
  test('從 permalink 路徑擷取', () => {
    const url = 'https://www.facebook.com/groups/123/permalink/789012';
    assert.equal(extractPostId(url), '789012');
  });

  test('從 story_fbid param 擷取', () => {
    const url = 'https://www.facebook.com/groups/123?story_fbid=999&id=123';
    assert.equal(extractPostId(url), '999');
  });

  test('從 /posts/ 路徑擷取', () => {
    const url = 'https://www.facebook.com/username/posts/111222333';
    assert.equal(extractPostId(url), '111222333');
  });

  test('找不到時回傳 null', () => {
    assert.equal(extractPostId('https://www.facebook.com/groups/123'), null);
    assert.equal(extractPostId(null), null);
  });
});

// ── extractGroupUrl() ─────────────────────────────────────────────────────────

describe('extractGroupUrl()', () => {
  test('從 permalink URL 擷取群組根 URL', () => {
    const url = 'https://www.facebook.com/groups/mygroup123/permalink/456789';
    assert.equal(extractGroupUrl(url), 'https://www.facebook.com/groups/mygroup123');
  });

  test('純數字 group ID', () => {
    const url = 'https://www.facebook.com/groups/123456789/permalink/999';
    assert.equal(extractGroupUrl(url), 'https://www.facebook.com/groups/123456789');
  });

  test('非 groups URL 回傳 null', () => {
    assert.equal(extractGroupUrl('https://www.facebook.com/username/posts/123'), null);
    assert.equal(extractGroupUrl(null), null);
  });
});

// ── isFbGroupPost() ───────────────────────────────────────────────────────────

describe('isFbGroupPost()', () => {
  test('permalink URL → true', () => {
    assert.ok(isFbGroupPost('https://www.facebook.com/groups/123/permalink/456'));
  });

  test('story_fbid URL → true', () => {
    assert.ok(isFbGroupPost('https://www.facebook.com/groups/123?story_fbid=456'));
  });

  test('群組首頁 URL → false', () => {
    assert.ok(!isFbGroupPost('https://www.facebook.com/groups/123'));
  });

  test('非 facebook URL → false', () => {
    assert.ok(!isFbGroupPost('https://example.com/groups/123/permalink/456'));
  });
});

// ── process() ─────────────────────────────────────────────────────────────────

describe('process()', () => {
  test('完整處理 FB 群組貼文 URL', () => {
    const raw = 'https://m.facebook.com/groups/mygroup/permalink/12345?fbclid=abc&ref=nf';
    const result = process(raw);
    assert.ok(result.canonical.includes('www.facebook.com'), 'canonical 應含 www');
    assert.ok(!result.canonical.includes('fbclid'), 'canonical 不應含 fbclid');
    assert.equal(result.post_id, '12345');
    assert.equal(result.group_url, 'https://www.facebook.com/groups/mygroup');
    assert.ok(result.is_fb_group_post, 'is_fb_group_post 應為 true');
    assert.equal(result.id.length, 64, 'id 應為 64 字元 sha256');
  });

  test('無效 URL 回傳全 null', () => {
    const result = process('');
    assert.equal(result.canonical, null);
    assert.equal(result.id, null);
    assert.equal(result.is_fb_group_post, false);
  });

  test('相同邏輯 URL 產出相同 id', () => {
    const a = process('https://m.facebook.com/groups/grp/permalink/999?fbclid=xxx');
    const b = process('https://www.facebook.com/groups/grp/permalink/999');
    assert.equal(a.id, b.id, '相同邏輯 URL 應有相同 id');
  });
});
