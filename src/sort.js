/* Stable sort helpers, exposed to content scripts and Node tests. */
(function (root) {
  'use strict';
  const SORT_MODES = Object.freeze(['default', 'published-desc', 'published-asc', 'duration-asc', 'duration-desc']);
  const isSortMode = (mode) => SORT_MODES.includes(mode);
  const validMetric = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  function sortVideos(items, mode) {
    const source = Array.isArray(items) ? items : [];
    if (!isSortMode(mode) || mode === 'default') return source.slice();
    const field = mode.startsWith('published-') ? 'pubdate' : 'duration';
    const direction = mode.endsWith('-desc') ? -1 : 1;
    return source.map((item, index) => ({ item, index })).sort((a, b) => {
      const x = validMetric(a.item?.[field]), y = validMetric(b.item?.[field]);
      if (x === null && y === null) return a.index - b.index;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x - y) * direction || a.index - b.index;
    }).map(({ item }) => item);
  }
  function formatDuration(seconds) {
    const v = validMetric(seconds);
    if (v === null) return '时长未知';
    const n = Math.floor(v), h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60), s = String(n % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }
  function formatPublished(timestamp) {
    if (validMetric(timestamp) === null) return '发布时间未知';
    const d = new Date(timestamp * 1000);
    if (!Number.isFinite(d.getTime())) return '发布时间未知';
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  }
  function videoLink(item) {
    if (typeof item?.bvid === 'string' && /^BV[0-9a-zA-Z]{10}$/.test(item.bvid))
      return `https://www.bilibili.com/list/watchlater?bvid=${encodeURIComponent(item.bvid)}`;
    if (Number.isSafeInteger(item?.aid) && item.aid > 0)
      return `https://www.bilibili.com/video/av${item.aid}`;
    return null;
  }
  function coverLink(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
      const url = new URL(value.startsWith('//') ? `https:${value}` : value);
      if (!['https:', 'http:'].includes(url.protocol) || !/(^|\.)hdslb\.com$/i.test(url.hostname)) return null;
      url.protocol = 'https:';
      return url.href;
    } catch { return null; }
  }
  const exported = Object.freeze({ SORT_MODES, isSortMode, sortVideos, formatDuration, formatPublished, videoLink, coverLink });
  root.WatchLaterSort = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);
