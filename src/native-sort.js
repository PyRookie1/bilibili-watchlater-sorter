/* Native-card lookup and rank calculations; pure functions for easy testing. */
(function (root) {
  'use strict';
  const BV_RE = /^BV[0-9a-zA-Z]{10}$/;
  function keyFromLink(href) {
    if (typeof href !== 'string' || !href.trim()) return null;
    try {
      const url = new URL(href, 'https://www.bilibili.com/');
      if (url.hostname !== 'bilibili.com' && !url.hostname.endsWith('.bilibili.com')) return null;
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      const queryBv = url.searchParams.get('bvid');
      if (queryBv && BV_RE.test(queryBv)) return 'bv:' + queryBv;
      const match = url.pathname.match(/(?:^|\/)\s*(BV[0-9a-zA-Z]{10})(?:\/|$)/);
      if (match) return 'bv:' + match[1];
      const avMatch = url.pathname.match(/(?:^|\/)av(\d+)(?:\/|$)/i);
      if (avMatch) return 'av:' + avMatch[1];
    } catch {}
    return null;
  }
  function keyFromCard(card) {
    if (!card || typeof card.querySelectorAll !== 'function') return null;
    const bvAttr = card.getAttribute('data-bvid') ||
      card.querySelector('[data-bvid]')?.getAttribute('data-bvid');
    if (bvAttr && BV_RE.test(bvAttr)) return 'bv:' + bvAttr;
    for (const link of card.querySelectorAll('a[href]')) {
      const key = keyFromLink(link.getAttribute('href'));
      if (key) return key;
    }
    return null;
  }
  function rankMap(videos, mode, sortVideos) {
    const ranks = new Map();
    const sorted = sortVideos(videos, mode);
    sorted.forEach((video, index) => {
      if (typeof video?.bvid === 'string' && BV_RE.test(video.bvid))
        ranks.set('bv:' + video.bvid, index);
      if (Number.isSafeInteger(video?.aid) && video.aid > 0)
        ranks.set('av:' + video.aid, index);
    });
    return ranks;
  }
  function displayOrders(cards, ranks, maxKnown) {
    // Preserve the native relative order of unknown/deleted items.
    return cards.map((card, index) => {
      const id = keyFromCard(card);
      return { card, key: id, order: id !== null && ranks.has(id)
        ? ranks.get(id) : maxKnown + index, matched: id !== null && ranks.has(id) };
    });
  }
  const exported = Object.freeze({ keyFromLink, keyFromCard, rankMap, displayOrders });
  root.WatchLaterNativeSort = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);
