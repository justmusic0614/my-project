/**
 * fb-groups-export.js — Facebook Groups Console Script (M1)
 *
 * 在瀏覽器開啟 https://www.facebook.com/groups/joins/ 後，
 * 在 DevTools Console 執行此腳本。
 *
 * 功能：
 * - 自動 scroll 到底（每次等 DOM 更新）
 * - MutationObserver 等待延遲載入的群組卡片
 * - 擷取：群組名稱、URL、公開/私人標記
 * - 匯出 JSON array，可直接貼為 data/sources.json
 *
 * 使用方式：
 * 1. 開啟 https://www.facebook.com/groups/joins/
 * 2. 打開 DevTools → Console
 * 3. 貼上全部內容並執行
 * 4. 等待 "Done" 訊息後，複製 console 輸出的 JSON
 * 5. 存到 src/agents/social-digest/data/sources.json
 */

(async function fbGroupsExport() {
  'use strict';

  const SCROLL_PAUSE_MS = 1200;   // 每次 scroll 後等待時間
  const MAX_SCROLL_ROUNDS = 40;   // 最多 scroll 次數（防無限迴圈）
  const MUTATION_WAIT_MS = 2000;  // MutationObserver 等待 DOM 靜止時間

  console.log('[fb-export] 開始匯出群組清單...');

  // ── Step 1: Scroll to bottom ────────────────────────────────────────────

  async function scrollToBottom() {
    let prevHeight = -1;
    let round = 0;
    while (round < MAX_SCROLL_ROUNDS) {
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(SCROLL_PAUSE_MS);
      const newHeight = document.body.scrollHeight;
      if (newHeight === prevHeight) {
        // 再等一輪確認真的到底
        await sleep(SCROLL_PAUSE_MS * 2);
        window.scrollTo(0, document.body.scrollHeight);
        const finalHeight = document.body.scrollHeight;
        if (finalHeight === newHeight) break;
        prevHeight = finalHeight;
      } else {
        prevHeight = newHeight;
      }
      round++;
      if (round % 5 === 0) {
        console.log(`[fb-export] scroll round ${round}, height=${newHeight}`);
      }
    }
    console.log(`[fb-export] scroll 完成（${round} 輪）`);
  }

  // ── Step 2: Wait for DOM mutations to settle ────────────────────────────

  function waitForMutationSettled(timeoutMs = MUTATION_WAIT_MS) {
    return new Promise(resolve => {
      let timer = null;
      const observer = new MutationObserver(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          observer.disconnect();
          resolve();
        }, 500);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      // 若 DOM 本來就靜止，直接 resolve
      timer = setTimeout(() => {
        observer.disconnect();
        resolve();
      }, timeoutMs);
    });
  }

  // ── Step 3: Extract group cards ─────────────────────────────────────────

  function extractGroups() {
    const results = [];
    const seen = new Set();

    // FB 的 groups/joins 頁面：每個群組以 a[href*="/groups/"] 連結為基準
    // 策略：找所有帶 /groups/ 的 <a>，過濾出真實群組頁（排除 /groups/joins 自身、
    //        /groups/feed、/groups/discover 等功能路徑）
    const GROUP_PATH_RE = /\/groups\/([^/?#]+)/;
    const EXCLUDE_SLUGS = new Set([
      'joins', 'feed', 'discover', 'explore', 'create', 'search', 'notifications',
      'membership', 'requests', 'invited', 'suggestions'
    ]);

    const anchors = document.querySelectorAll('a[href*="/groups/"]');

    for (const a of anchors) {
      const href = a.href || '';
      const m = GROUP_PATH_RE.exec(href);
      if (!m) continue;

      const slug = m[1].split('/')[0];  // 取第一段（group ID 或 vanity name）
      if (EXCLUDE_SLUGS.has(slug)) continue;
      if (/^\d{15,}$/.test(slug) === false && slug.length < 2) continue; // 太短的路徑

      // 正規化 URL（去 tracking params，統一 www）
      let url;
      try {
        const u = new URL(href);
        u.search = '';      // 去掉所有 query
        u.hash = '';
        u.hostname = u.hostname.replace(/^m\./, 'www.');
        url = u.toString().replace(/\/$/, '');
      } catch {
        continue;
      }

      if (seen.has(url)) continue;
      seen.add(url);

      // 嘗試找群組名稱：往上找 container，找其中最接近的文字節點
      const name = extractGroupName(a) || slug;

      // 嘗試判斷公開/私人：找包含「公開」「私人」「Private」「Public」的鄰近文字
      const isPublic = detectPublic(a);

      results.push({
        type: 'group',
        name,
        url,
        public: isPublic,
        enabled: true,
        weight: 1.0,
        tags: [],
        must_include: false
      });
    }

    return results;
  }

  function extractGroupName(anchor) {
    // 策略：找 anchor 的祖先（最多 6 層），取其中最像群組名的文字
    let el = anchor;
    for (let i = 0; i < 6; i++) {
      el = el.parentElement;
      if (!el) break;
      // 找 span/div 帶明顯文字（非空、非 icon）
      const candidates = el.querySelectorAll('span, div, h3, h4');
      for (const c of candidates) {
        // 直接子文字節點
        const text = c.childNodes.length === 1 && c.childNodes[0].nodeType === 3
          ? c.textContent.trim()
          : c.textContent.trim();
        if (text && text.length >= 2 && text.length <= 100
            && !/^[\d,]+$/.test(text)           // 排除純數字（成員數）
            && !text.includes('·')              // 排除「1,234 · 公開」類描述
        ) {
          return text;
        }
      }
    }
    return null;
  }

  function detectPublic(anchor) {
    // 在祖先容器中找「公開」「Public」關鍵字
    let el = anchor;
    for (let i = 0; i < 8; i++) {
      el = el.parentElement;
      if (!el) return false;
      const text = el.textContent || '';
      if (/公開|Public group/i.test(text)) return true;
      if (/私人|Private group/i.test(text)) return false;
    }
    return false;  // 不確定時預設 false（保守）
  }

  // ── Step 4: "Load more" button clicker ──────────────────────────────────

  async function clickLoadMore() {
    let clicked = 0;
    const btnTexts = ['查看更多', 'See More', 'See more', 'Load more', '更多'];
    for (const text of btnTexts) {
      const btns = [...document.querySelectorAll('div[role="button"], button')].filter(
        b => b.textContent.trim() === text
      );
      for (const btn of btns) {
        btn.click();
        clicked++;
        await sleep(600);
      }
    }
    return clicked;
  }

  // ── Util ────────────────────────────────────────────────────────────────

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Main ────────────────────────────────────────────────────────────────

  // scroll + click load more 多輪
  for (let pass = 0; pass < 3; pass++) {
    await scrollToBottom();
    const clicked = await clickLoadMore();
    if (clicked > 0) {
      console.log(`[fb-export] pass ${pass+1}: clicked ${clicked} "load more" buttons`);
      await waitForMutationSettled();
    } else {
      break;
    }
  }

  // 最後再 scroll 一次確保全部載入
  await scrollToBottom();
  await waitForMutationSettled(1500);

  // 擷取
  const groups = extractGroups();
  console.log(`[fb-export] 擷取到 ${groups.length} 個群組`);

  if (groups.length === 0) {
    console.warn('[fb-export] 沒有找到群組！請確認：');
    console.warn('  1. 頁面為 https://www.facebook.com/groups/joins/');
    console.warn('  2. 已登入 Facebook');
    console.warn('  3. 頁面已完全載入');
  } else {
    console.log('[fb-export] === 複製以下 JSON 貼到 data/sources.json ===');
    console.log(JSON.stringify(groups, null, 2));
    console.log('[fb-export] Done.');
  }

  return groups;
})();
