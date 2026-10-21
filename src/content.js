/* One native-page dropdown. Full sorting occurs in Bilibili's Pinia list store. */
(() => {
  'use strict';
  if (document.getElementById('wl-sorter-root')) return;
  const { isSortMode } = globalThis.WatchLaterSort;
  const CHANNEL = 'wl-sorter-bilibili-v1';
  const KEY = 'wl-sorter-mode';
  const OPTIONS = [
    ['default', 'B站默认顺序'],
    ['published-desc', '发布时间：最新优先'],
    ['published-asc', '发布时间：最早优先'],
    ['duration-asc', '总时长：短到长'],
    ['duration-desc', '总时长：长到短']
  ];
  let mode = 'default';
  try {
    const saved = localStorage.getItem(KEY);
    if (isSortMode(saved)) mode = saved;
  } catch {}
  let cached = null;
  let nativeGrid = null;
  let scheduled = false;
  let initial = mode !== 'default';

  const root = document.createElement('div');
  root.id = 'wl-sorter-root';
  const label = document.createElement('label');
  label.className = 'wl-sorter-label';
  label.textContent = '排序';
  const select = document.createElement('select');
  select.className = 'wl-sorter-select';
  select.setAttribute('aria-label', '稍后再看全量排序方式');
  for (const [value, caption] of OPTIONS) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = caption;
    select.append(option);
  }
  select.value = mode;
  label.append(select);
  const error = document.createElement('span');
  error.className = 'wl-sorter-error';
  error.setAttribute('role', 'status');
  error.hidden = true;
  root.append(label, error);

  function report(text = '') {
    error.textContent = text;
    error.hidden = !text;
    select.title = text || '完整列表原生排序';
  }
  function isListPage() {
    return /^\/(?:watchlater(?:\/list)?|list\/watchlater)\/?$/.test(location.pathname) &&
      (!location.hash || /^#\/list(?:[/?#]|$)/.test(location.hash));
  }
  function findAnchor(grid) {
    const y = grid.getBoundingClientRect().top;
    for (const element of document.querySelectorAll('button, [role="button"], [class*="sort"], span')) {
      if (root.contains(element)) continue;
      const caption = element.textContent?.replace(/[\s▼▽⌄▾∨]/g, '');
      if (caption !== '最近添加' && caption !== '最早添加') continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.top > y) continue;
      return element.closest('button,[role="button"],[class*="dropdown"],[class*="sort"],[class*="select"]') || element;
    }
    return null;
  }
  function mount() {
    const grid = isListPage() ? document.querySelector('.watchlater-list-container') : null;
    if (grid !== nativeGrid) {
      nativeGrid = grid;
      root.remove();
      if (grid && mode !== 'default') initial = true;
    }
    if (!grid) { root.remove(); return false; }
    if (!root.isConnected) {
      const anchor = findAnchor(grid);
      const host = anchor?.parentElement || grid.parentElement;
      if (!host) return false;
      root.dataset.placement = anchor ? 'inline' : 'fallback';
      if (anchor) host.insertBefore(root, anchor);
      else host.insertBefore(root, grid);
    }
    return true;
  }
  function requestPage(type, fields, timeoutMs = 12000) {
    return new Promise(resolve => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => finish(null), timeoutMs);
      function finish(message) {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(message);
      }
      function onMessage(event) {
        if (event.source !== window || event.origin !== location.origin) return;
        const data = event.data;
        if (data?.channel !== CHANNEL || data.id !== id) return;
        if (data.type === 'MODE_RESULT' || data.type === 'RESPONSE') finish(data);
      }
      window.addEventListener('message', onMessage);
      window.postMessage({ channel: CHANNEL, type, id, ...fields }, location.origin);
    });
  }
  function complete(result) {
    return result?.ok && Array.isArray(result.items) &&
      Number.isSafeInteger(result.count) && result.count === result.items.length;
  }
  async function fullData() {
    if (cached) return cached;
    let backgroundError = '后台没有返回完整列表';
    try {
      const data = await chrome.runtime.sendMessage({ type: 'WL_SORTER_FETCH' });
      if (complete(data)) return cached = data.items;
      backgroundError = data?.error || backgroundError;
    } catch (reason) {
      backgroundError = reason?.message || String(reason);
    }
    const fallback = await requestPage('REQUEST', {}, 35000);
    if (complete(fallback?.payload)) return cached = fallback.payload.items;
    throw new Error(backgroundError + '；备用接口：' +
      (fallback?.payload?.error || '没有返回完整列表'));
  }
  async function choose(next) {
    if (!isSortMode(next)) return;
    mode = next;
    select.value = mode;
    report('');
    try { localStorage.setItem(KEY, mode); } catch {}
    // Let Bilibili's own loadMore action finish; do not scroll or alter cards.
    select.disabled = true;
    select.title = '正在整理原生完整列表';
    try {
      if (!mount()) throw new Error('未找到 B站稍后再看原生列表');
      const items = await fullData();
      const result = await requestPage('SET_MODE', { mode, items }, 120000);
      if (!result?.ok) throw new Error(result?.error || '原生列表排序超时或页面脚本未响应');
      report('');
      select.title = '已在原生列表排序全部 ' + result.count + ' 条视频';
    } catch (reason) {
      // Stale data after a Bilibili delete or filter can be refreshed by
      // simply choosing another mode; failed sorts must not be called "full".
      cached = null;
      report('全量排序失败：' + (reason?.message || reason));
    } finally {
      select.disabled = false;
    }
  }
  select.addEventListener('change', () => { void choose(select.value); });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'WL_SORTER_OPEN' && root.isConnected) select.focus();
  });
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      if (!mount()) return;
      if (initial) {
        initial = false;
        void choose(mode);
      }
    }, 120);
  }
  window.addEventListener('hashchange', schedule);
  window.addEventListener('popstate', schedule);
  new MutationObserver(records => {
    if (records.some(record => !root.contains(record.target) &&
      [...record.addedNodes, ...record.removedNodes].some(node => node !== root))) schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
