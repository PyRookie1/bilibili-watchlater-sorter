/* Pure helpers for matching native Bilibili cards to the full API list. */
(function (root) {
  'use strict';
  const BV_RE = /^BV[0-9A-Za-z]{10}$/;
  function keyFromLink(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try {
      const url = new URL(raw, 'https://www.bilibili.com/');
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      if (url.hostname !== 'bilibili.com' && !url.hostname.endsWith('.bilibili.com')) return null;
      const bvid = url.searchParams.get('bvid');
      if (bvid && BV_RE.test(bvid)) return 'bv:' + bvid;
      const match = url.pathname.match(/(?:^|\/)(BV[0-9A-Za-z]{10})(?:\/|$)/);
      if (match) return 'bv:' + match[1];
      const av = url.pathname.match(/(?:^|\/)av(\d+)(?:\/|$)/i);
      if (av) return 'av:' + av[1];
      const aid = url.searchParams.get('aid');
      if (aid && /^[1-9]\d*$/.test(aid)) return 'av:' + aid;
    } catch {}
    return null;
  }
  function keyFromCard(card) {
    if (!card || typeof card.querySelectorAll !== 'function') return null;
    const bvid = card.getAttribute('data-bvid') || card.querySelector('[data-bvid]')?.getAttribute('data-bvid');
    if (bvid && BV_RE.test(bvid)) return 'bv:' + bvid;
    for (const link of card.querySelectorAll('a[href]')) {
      const key = keyFromLink(link.getAttribute('href'));
      if (key) return key;
    }
    const aid = card.getAttribute('data-aid') || card.querySelector('[data-aid]')?.getAttribute('data-aid');
    if (aid && /^[1-9]\d*$/.test(aid)) return 'av:' + aid;
    return null;
  }
  function ranksFromVideos(videos, mode, sortVideos) {
    const sorted = sortVideos(videos, mode);
    const ranks = new Map();
    sorted.forEach((video, index) => {
      if (typeof video?.bvid === 'string' && BV_RE.test(video.bvid)) ranks.set('bv:' + video.bvid, index);
      if (Number.isSafeInteger(video?.aid) && video.aid > 0) ranks.set('av:' + video.aid, index);
    });
    return ranks;
  }
  function matchNativeEntries(entries, ranks, total) {
    const used = new Set();
    const ranked = entries.map(({ host, card }) => {
      const key = keyFromCard(card);
      const rank = key === null ? undefined : ranks.get(key);
      if (rank !== undefined) used.add(rank);
      return { host, key, rank };
    });
    const matched = ranked.filter(x => x.rank !== undefined).length;
    return {
      ranked,
      matched,
      complete: Number.isSafeInteger(total) && total >= 0 && entries.length === total &&
        matched === total && used.size === total
    };
  }
  const api = Object.freeze({ keyFromLink, keyFromCard, ranksFromVideos, matchNativeEntries });
  root.WatchLaterNativeSort = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
