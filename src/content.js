/* Native watch-later sort selector. Each page opens in Bilibili default order.
 * Full metadata and native records preload in parallel before a sort is chosen.
 */
(() => {
  'use strict';
  if (document.getElementById('wl-sorter-root')) return;
  const { isSortMode, formatPublished } = globalThis.WatchLaterSort;
  const dateOverlay = globalThis.WatchLaterDateOverlay;
  const CHANNEL = 'wl-sorter-bilibili-v1';
  const OPTIONS = [
    ['default', '默认'],
    ['published-desc', '发布时间：最新优先'],
    ['published-asc', '发布时间：最早优先'],
    ['duration-asc', '总时长：短到长'],
    ['duration-desc', '总时长：长到短']
  ];
  let mode = 'default';
  let cached = null;
  let dataPromise = null;
  let nativeGrid = null;
  let preparedGrid = null;
  let scheduled = false;
  let revision = 0;
  let activeDates = null;

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
  select.value = 'default';
  label.append(select);
  const error = document.createElement('span');
  error.className = 'wl-sorter-error';
  error.setAttribute('role', 'status');
  error.hidden = true;
  root.append(label, error);

  function report(message = '') {
    error.textContent = message;
    error.title = message;
    error.hidden = !message;
    select.title = message || '完整列表原生排序';
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
      dateOverlay.clear(nativeGrid);
      nativeGrid = grid;
      root.remove();
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
  function requestPage(type, fields = {}, timeoutMs = 12000) {
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
        if (['PREPARE_RESULT', 'MODE_RESULT', 'RESPONSE'].includes(data.type))
          finish(data);
      }
      window.addEventListener('message', onMessage);
      window.postMessage({ channel: CHANNEL, type, id, ...fields }, location.origin);
    });
  }
  function complete(result) {
    return result?.ok && Array.isArray(result.items) &&
      Number.isSafeInteger(result.count) && result.count === result.items.length;
  }
  async function fetchFullData() {
    const early = await (globalThis.WatchLaterEarlyDataPromise || Promise.resolve(null));
    if (complete(early)) return early.items;
    let backgroundError = '后台没有返回完整列表';
    try {
      const data = await chrome.runtime.sendMessage({ type: 'WL_SORTER_FETCH' });
      if (complete(data)) return data.items;
      backgroundError = data?.error || backgroundError;
    } catch (reason) {
      backgroundError = reason?.message || String(reason);
    }
    const fallback = await requestPage('REQUEST', {}, 35000);
    if (complete(fallback?.payload)) return fallback.payload.items;
    throw new Error(backgroundError + '；备用接口：' +
      (fallback?.payload?.error || '没有返回完整列表'));
  }
  function fullData() {
    if (cached) return Promise.resolve(cached);
    if (!dataPromise) {
      dataPromise = fetchFullData().then(items => {
        cached = items;
        return items;
      }).finally(() => { dataPromise = null; });
    }
    return dataPromise;
  }
  function beginPreload() {
    if (!nativeGrid || !isListPage() || preparedGrid === nativeGrid) return;
    preparedGrid = nativeGrid;
    // Run independently: both requests start while the native page is opening.
    void fullData().catch(() => {});
    void requestPage('PREPARE', {}, 120000);
  }
  function showPublicationDates() {
    if (nativeGrid && activeDates) dateOverlay.render(nativeGrid, activeDates);
  }
  async function choose(next) {
    if (!isSortMode(next)) return;
    const current = ++revision;
    mode = next;
    select.value = next;
    activeDates = null;
    dateOverlay.clear(nativeGrid);
    report('');
    // No stored preference: refreshing always opens in the Bilibili default mode.
    select.disabled = true;
    select.title = '正在应用完整列表排序';
    try {
      if (!mount()) throw new Error('未找到 B站稍后再看原生列表');
      beginPreload();
      const items = await fullData();
      const result = await requestPage('SET_MODE', { mode: next, items }, 120000);
      if (current !== revision) return;
      if (!result?.ok)
        throw new Error(result?.error || '原生列表排序超时或页面脚本未响应');
      if (next !== 'default') {
        activeDates = dateOverlay.dateMap(items, formatPublished);
        showPublicationDates();
      }
      select.title = '已在原生列表排序全部 ' + result.count + ' 条视频';
    } catch (reason) {
      if (current !== revision) return;
      cached = null;
      report('全量排序失败：' + (reason?.message || reason));
    } finally {
      if (current === revision) select.disabled = false;
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
      if (mount()) {
        beginPreload();
        showPublicationDates();
      }
    }, 100);
  }
  window.addEventListener('hashchange', schedule);
  window.addEventListener('popstate', schedule);
  new MutationObserver(records => {
    if (records.some(record => !root.contains(record.target) &&
      [...record.addedNodes, ...record.removedNodes].some(node => node !== root))) schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
