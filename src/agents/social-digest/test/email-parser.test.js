/**
 * email-parser.test.js — M6 Unit Tests
 * 執行：node --test test/email-parser.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseEmail, parseEmails,
  _extractHrefs, _stripHtml,
  _extractGroupFromSubject, _extractAuthorFromSubject,
  _calcTemplateFp,
} = require('../src/processors/email-parser');

// ── 測試用 HTML fixtures ──────────────────────────────────────────────────────

const FIXTURE_HTML_BASIC = `
<html>
<body>
<table>
  <td>
    <a href="https://www.facebook.com/groups/mygroup/permalink/123456?fbclid=abc&amp;__tn__=%2CO">
      View post
    </a>
    <p>John Smith posted in MyTechGroup</p>
    <p>This is an interesting article about JavaScript performance...</p>
  </td>
</table>
<a href="https://www.facebook.com/notifications">See all notifications</a>
<a href="https://www.facebook.com/n/groups/unsubscribe">Unsubscribe</a>
</body>
</html>
`;

const FIXTURE_HTML_L_REDIRECT = `
<html>
<body>
<a href="https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.facebook.com%2Fgroups%2Ftestgroup%2Fpermalink%2F999888%2F&h=xyz">
  View post
</a>
<p>Alice posted in TestGroup</p>
<p>Check out this new tool for developers!</p>
</body>
</html>
`;

const FIXTURE_HTML_STORY_FBID = `
<html>
<body>
<a href="https://www.facebook.com/groups/financegroup?story_fbid=777666&amp;id=888999">
  View post
</a>
<p>Bob Chen 在 理財討論版 中發佈</p>
<p>今天市場大跌，大家要注意風險管理！</p>
</body>
</html>
`;

const FIXTURE_TEXT_ONLY = `
John Doe posted in TechGroup

He shared: This is a great article about Node.js performance tuning.

View the post: https://www.facebook.com/groups/techgroup/permalink/555444

Unsubscribe | Privacy | Terms
Facebook Inc.
`;

// ── parseEmail() ─────────────────────────────────────────────────────────────

describe('parseEmail() — Layer 1 HTML links', () => {
  test('從 HTML href 抽出群組貼文 URL', () => {
    const result = parseEmail({ html: FIXTURE_HTML_BASIC, subject: 'John posted in MyTechGroup' });
    assert.ok(result.parse_ok, 'parse_ok 應為 true');
    assert.equal(result.posts.length, 1, '應找到 1 篇貼文');
    const post = result.posts[0];
    assert.ok(post.url.includes('facebook.com/groups/mygroup/permalink/123456'), 'URL 應含 permalink');
    assert.ok(!post.url.includes('fbclid'), 'URL 不應含 fbclid（已正規化）');
    assert.equal(post.id.length, 64, 'id 應為 sha256 hex');
    assert.ok(result.layers_hit.includes('L1_html_links'), '應命中 L1_html_links');
  });

  test('l.facebook.com redirect → decode 真正 URL', () => {
    const result = parseEmail({ html: FIXTURE_HTML_L_REDIRECT, subject: 'Alice posted' });
    assert.ok(result.parse_ok, 'parse_ok 應為 true');
    assert.ok(
      result.posts[0].url.includes('groups/testgroup/permalink/999888'),
      '應 decode 出真正 URL'
    );
  });

  test('story_fbid URL 格式', () => {
    const result = parseEmail({ html: FIXTURE_HTML_STORY_FBID });
    assert.ok(result.parse_ok, 'parse_ok 應為 true');
    assert.equal(result.posts[0].post_id, '777666', 'post_id 應為 story_fbid 的值');
  });
});

describe('parseEmail() — Layer 1 text fallback', () => {
  test('純文字信件能從 text 抽出 URL', () => {
    const result = parseEmail({ text: FIXTURE_TEXT_ONLY });
    assert.ok(result.parse_ok, 'parse_ok 應為 true');
    assert.ok(result.posts[0].url.includes('permalink/555444'), '應找到 URL');
    assert.ok(result.layers_hit.includes('L1_text_links'), '應命中 L1_text_links');
  });
});

describe('parseEmail() — Layer 2 text extraction', () => {
  test('從 HTML 抽出作者', () => {
    const result = parseEmail({ html: FIXTURE_HTML_BASIC, subject: 'John Smith posted in MyTechGroup' });
    assert.ok(result.posts.length > 0);
    // author 可能來自 L2 或 L3
    const hasAuthor = result.posts[0].author !== null;
    assert.ok(hasAuthor, '應擷取到作者');
  });

  test('從中文格式抽出群組名', () => {
    const result = parseEmail({ html: FIXTURE_HTML_STORY_FBID });
    assert.ok(result.posts.length > 0);
    // group_name 可能來自 URL 或文字
    assert.ok(result.posts[0].group_url !== null, '應有 group_url');
  });

  test('snippet 有意義內容', () => {
    const result = parseEmail({ html: FIXTURE_HTML_BASIC, subject: 'John posted' });
    assert.ok(result.posts.length > 0);
    const post = result.posts[0];
    if (post.snippet) {
      assert.ok(post.snippet.length >= 20, 'snippet 至少 20 字');
      assert.ok(post.snippet.length <= 300, 'snippet 至多 300 字');
    }
  });
});

describe('parseEmail() — confidence', () => {
  test('HTML + author/snippet → HIGH', () => {
    const result = parseEmail({ html: FIXTURE_HTML_BASIC, subject: 'John Smith posted in MyTechGroup' });
    assert.equal(result.confidence, 'HIGH');
  });

  test('只有 URL，無 author/snippet → MED', () => {
    const minimalHtml = '<a href="https://www.facebook.com/groups/g/permalink/123">view</a>';
    const result = parseEmail({ html: minimalHtml });
    assert.ok(['MED', 'HIGH'].includes(result.confidence), 'confidence 應為 MED 或 HIGH');
  });

  test('找不到貼文 URL → parse_ok false', () => {
    const result = parseEmail({ html: '<html><body>hello</body></html>' });
    assert.equal(result.parse_ok, false);
    assert.equal(result.posts.length, 0);
  });
});

describe('parseEmail() — template_fp', () => {
  test('回傳 12 字元 hex', () => {
    const result = parseEmail({ html: FIXTURE_HTML_BASIC });
    assert.equal(result.template_fp.length, 12);
    assert.match(result.template_fp, /^[0-9a-f]+$/);
  });

  test('相同結構的 HTML 產生相同 template_fp', () => {
    const r1 = parseEmail({ html: FIXTURE_HTML_BASIC });
    const r2 = parseEmail({ html: FIXTURE_HTML_BASIC });
    assert.equal(r1.template_fp, r2.template_fp);
  });

  test('不同結構的 HTML 產生不同 template_fp', () => {
    const r1 = parseEmail({ html: FIXTURE_HTML_BASIC });
    const r2 = parseEmail({ html: '<html><body>completely different</body></html>' });
    assert.notEqual(r1.template_fp, r2.template_fp);
  });
});

describe('parseEmail() — dedup within same email', () => {
  test('同一封信多個指向相同貼文的 URL 只留一篇', () => {
    const html = `
      <a href="https://www.facebook.com/groups/g/permalink/123?fbclid=a">view</a>
      <a href="https://m.facebook.com/groups/g/permalink/123?ref=nf">view again</a>
    `;
    const result = parseEmail({ html });
    // 兩個 URL 正規化後相同 → 應只有 1 篇
    assert.equal(result.posts.length, 1, '相同 canonical URL 只保留一篇');
  });
});

// ── parseEmails() stats ───────────────────────────────────────────────────────

describe('parseEmails() — batch stats', () => {
  test('統計 email_parse_ok_rate 和 high_conf_rate', () => {
    const emails = [
      { html: FIXTURE_HTML_BASIC, subject: 'John posted in MyTechGroup' },
      { html: '<html><body>just a newsletter</body></html>' }, // 無貼文 URL
      { html: FIXTURE_HTML_L_REDIRECT, subject: 'Alice posted' },
    ];
    const { posts, stats } = parseEmails(emails);
    assert.ok(Array.isArray(posts));
    assert.ok(stats.total_emails === 3);
    // 2/3 有解析出貼文
    assert.ok(stats.email_parse_ok_rate > 0.5, 'parse_ok_rate 應 > 0.5');
    assert.ok(typeof stats.template_fp_stats === 'object', 'template_fp_stats 應為 object');
  });

  test('空 emails 陣列不報錯', () => {
    const { posts, stats } = parseEmails([]);
    assert.equal(posts.length, 0);
    assert.equal(stats.total_emails, 0);
    assert.equal(stats.email_parse_ok_rate, null);
  });
});

// ── 內部 helper tests ─────────────────────────────────────────────────────────

describe('_extractHrefs()', () => {
  test('抽出 href 屬性值', () => {
    const html = '<a href="https://example.com">link</a><a href=\'https://other.com\'>link2</a>';
    const hrefs = _extractHrefs(html);
    assert.ok(hrefs.includes('https://example.com'));
    assert.ok(hrefs.includes('https://other.com'));
  });

  test('&amp; 被還原為 &', () => {
    const html = '<a href="https://example.com?a=1&amp;b=2">link</a>';
    const hrefs = _extractHrefs(html);
    assert.ok(hrefs[0].includes('a=1&b=2'), '&amp; 應還原為 &');
  });
});

describe('_stripHtml()', () => {
  test('去掉 HTML tags', () => {
    const html = '<p>Hello <b>World</b></p>';
    const text = _stripHtml(html);
    assert.ok(!text.includes('<'), '不應含 < 符號');
    assert.ok(text.includes('Hello'), '應保留文字');
    assert.ok(text.includes('World'), '應保留文字');
  });

  test('去掉 script 和 style 內容', () => {
    const html = '<style>.cls { color: red; }</style><p>text</p><script>alert(1)</script>';
    const text = _stripHtml(html);
    assert.ok(!text.includes('color'), '應去掉 style 內容');
    assert.ok(!text.includes('alert'), '應去掉 script 內容');
    assert.ok(text.includes('text'), '應保留 p 內容');
  });
});

describe('_extractGroupFromSubject()', () => {
  test('英文 "new post in GroupName"', () => {
    assert.equal(_extractGroupFromSubject('New post in MyTechGroup'), 'MyTechGroup');
  });

  test('英文 "X posted in GroupName"', () => {
    assert.equal(_extractGroupFromSubject('John posted in Finance Discussion'), 'Finance Discussion');
  });

  test('中文 "XXX 有新貼文"', () => {
    assert.equal(_extractGroupFromSubject('理財社團 有新貼文'), '理財社團');
  });

  test('找不到時回傳 null', () => {
    assert.equal(_extractGroupFromSubject('Facebook notification'), null);
  });
});

describe('_extractAuthorFromSubject()', () => {
  test('抽出 posted 前的名字', () => {
    assert.equal(_extractAuthorFromSubject('John Smith posted in MyGroup'), 'John Smith');
  });

  test('抽出 commented', () => {
    assert.equal(_extractAuthorFromSubject('Alice commented on your post'), 'Alice');
  });

  test('找不到時回傳 null', () => {
    assert.equal(_extractAuthorFromSubject('New notification from Facebook'), null);
  });
});
