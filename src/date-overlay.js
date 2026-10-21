/* Publication dates for Bilibili's existing watch-later cover previews.
 * No replacement cards, network requests, or change to native click handlers.
 */
(function (root) {
  'use strict';
  const BV = /^BV[0-9A-Za-z]{10}$/;
  const AID = /^[1-9]\d*$/;
  const BADGE = 'wl-sorter-published';
  const RELATIVE = 'wl-sorter-cover-relative';

  function keyFromHref(href) {
    if (typeof href !== 'string' || !href.trim()) return null;
    try {
      const url = new URL(href, 'https://www.bilibili.com/');
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      if (url.hostname !== 'bilibili.com' && !url.hostname.endsWith('.bilibili.com'))
        return null;
      const bvid = url.searchParams.get('bvid');
      if (bvid && BV.test(bvid)) return 'bv:' + bvid;
      const pathBV = url.pathname.match(/(?:^|\/)(BV[0-9A-Za-z]{10})(?:\/|$)/);
      if (pathBV) return 'bv:' + pathBV[1];
      const aid = url.searchParams.get('aid');
      if (aid && AID.test(aid)) return 'av:' + aid;
      const pathAV = url.pathname.match(/(?:^|\/)av(\d+)(?:\/|$)/i);
      if (pathAV) return 'av:' + pathAV[1];
    } catch {}
    return null;
  }

  function cardKeys(card) {
    const keys = [];
    const bvid = card.getAttribute('data-bvid') ||
      card.querySelector('[data-bvid]')?.getAttribute('data-bvid');
    if (bvid && BV.test(bvid)) keys.push('bv:' + bvid);
    const aid = card.getAttribute('data-aid') ||
      card.querySelector('[data-aid]')?.getAttribute('data-aid');
    if (aid && AID.test(aid)) keys.push('av:' + aid);
    for (const anchor of card.querySelectorAll('a[href]')) {
      const key = keyFromHref(anchor.getAttribute('href'));
      if (key) keys.push(key);
    }
    return keys;
  }

  function dateMap(items, formatPublished) {
    const dates = new Map();
    if (!Array.isArray(items)) return dates;
    for (const video of items) {
      if (!Number.isFinite(video?.pubdate) || video.pubdate <= 0) continue;
      const date = formatPublished(video.pubdate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (BV.test(video.bvid || '')) dates.set('bv:' + video.bvid, date);
      if (Number.isSafeInteger(video.aid) && video.aid > 0)
        dates.set('av:' + video.aid, date);
    }
    return dates;
  }

  function coverHost(card) {
    const img = card.querySelector(
      '[class*="cover"] img, [class*="thumbnail"] img, [class*="pic"] img, a[href] img, img'
    );
    if (!img) return null;
    let host = img.closest('[class*="cover"], [class*="thumbnail"], [class*="pic"]');
    if (!host || host === card || !card.contains(host))
      host = img.closest('a[href]') || img.parentElement;
    if (host?.tagName === 'PICTURE') host = host.parentElement;
    return host && host !== card && card.contains(host) ? host : null;
  }

  function removeCardBadge(card) {
    for (const badge of card.querySelectorAll('.' + BADGE)) {
      const host = badge.parentElement;
      badge.remove();
      host?.classList.remove(RELATIVE);
    }
  }

  function clear(grid) {
    if (!grid) return;
    for (const card of grid.querySelectorAll('.video-card')) removeCardBadge(card);
  }

  function render(grid, dates) {
    if (!grid || !(dates instanceof Map)) return { shown: 0, cards: 0 };
    const cards = grid.querySelectorAll('.video-card');
    let shown = 0;
    for (const card of cards) {
      const key = cardKeys(card).find(key => dates.has(key));
      const text = key ? dates.get(key) : null;
      const host = text ? coverHost(card) : null;
      const badges = card.querySelectorAll('.' + BADGE);
      let badge = badges[0] || null;
      for (const extra of [...badges].slice(1)) {
        const previous = extra.parentElement;
        extra.remove();
        previous?.classList.remove(RELATIVE);
      }
      if (!host) {
        if (badge) removeCardBadge(card);
        continue;
      }
      if (badge && badge.parentElement !== host) {
        const previous = badge.parentElement;
        badge.remove();
        previous?.classList.remove(RELATIVE);
        badge = null;
      }
      if (!badge) {
        badge = card.ownerDocument.createElement('span');
        badge.className = BADGE;
        badge.setAttribute('aria-label', '发布时间：' + text);
        badge.textContent = text;
        // A static cover wrapper needs a containing block for absolute placement.
        if (getComputedStyle(host).position === 'static')
          host.classList.add(RELATIVE);
        host.append(badge);
      } else if (badge.textContent !== text) {
        badge.textContent = text;
        badge.setAttribute('aria-label', '发布时间：' + text);
      }
      shown++;
    }
    return { shown, cards: cards.length };
  }

  const api = Object.freeze({ keyFromHref, cardKeys, dateMap, clear, render });
  root.WatchLaterDateOverlay = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
