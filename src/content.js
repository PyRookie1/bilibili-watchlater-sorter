(() => {
  'use strict';
  if (document.getElementById('wl-sorter-root')) return;
  const { sortVideos, isSortMode } = globalThis.WatchLaterSort;
  const { ranksFromVideos, matchNativeEntries } = globalThis.WatchLaterNativeSort;
  const CHANNEL = 'wl-sorter-bilibili-v1';
  const STORE = 'wl-sorter-mode';
  const OPTIONS = [
    ['default', 'B站默认顺序'],
    ['published-desc', '发布时间：最新优先'],
    ['published-asc', '发布时间：最早优先'],
    ['duration-asc', '总时长：短到长'],
    ['duration-desc', '总时长：长到短']
  ];
  let mode = 'default';
  try {
    const saved = localStorage.getItem(STORE);
    if (isSortMode(saved)) mode = saved;
  } catch {}
  let grid = null;
  let originalOrders = new Map();
  let videos = null;
  let scheduled = false;
  let requestId = 0;
  let reactiveApplied = false;

  const root = document.createElement('div');
  root.id = 'wl-sorter-root';
  const label = document.createElement('label');
  label.className = 'wl-sorter-label';
  label.textContent = '排序';
  const select = document.createElement('select');
  select.className = 'wl-sorter-select';
  select.setAttribute('aria-label', '视频排序方式');
  for (const [value, name] of OPTIONS) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = name;
    select.append(option);
  }
  select.value = mode;
  label.append(select);
  root.append(label);

  function isListPage() {
    return /^\/(?:watchlater(?:\/list)?|list\/watchlater)\/?$/.test(location.pathname) &&
      (!location.hash || /^#\/list(?:[/?#]|$)/.test(location.hash));
  }
  function findNativeSort(currentGrid) {
    const top = currentGrid.getBoundingClientRect().top;
    for (const el of document.querySelectorAll('button, [role="button"], [class*="sort"], span')) {
      if (root.contains(el)) continue;
      const text = el.textContent?.replace(/[\s▼▽⌄▾∨]/g, '');
      if (text !== '最近添加' && text !== '最早添加') continue;
      const rect = el.getBoundingClientRect();
      if (!rect.height || !rect.width || rect.top > top) continue;
      return el.closest('button, [role="button"], [class*="dropdown"], [class*="sort"], [class*="select"]') || el;
    }
    return null;
  }
  function resetInlineOrders() {
    for (const [node, prior] of originalOrders) {
      if (prior.value) node.style.setProperty('order', prior.value, prior.priority);
      else node.style.removeProperty('order');
    }
    originalOrders.clear();
  }
  function mount() {
    const current = isListPage() ? document.querySelector('.watchlater-list-container') : null;
    if (!current) {
      if (grid) resetInlineOrders();
      grid = null;
      root.remove();
      return false;
    }
    if (current !== grid) {
      resetInlineOrders();
      grid = current;
      root.remove();
      reactiveApplied = false;
    }
    if (!root.isConnected) {
      const anchor = findNativeSort(grid);
      const container = anchor?.parentElement || grid.parentElement;
      if (!container) return false;
      root.dataset.placement = anchor ? 'inline' : 'fallback';
      if (anchor) container.insertBefore(root, anchor);
      else container.insertBefore(root, grid);
    }
    return true;
  }
  function scanNativeEntries() {
    if (!grid) return null;
    const cards = [...grid.querySelectorAll('.video-card')];
    if (!cards.length) return null;
    for (let layout = cards[0].parentElement; layout && grid.contains(layout); layout = layout.parentElement) {
      const display = getComputedStyle(layout).display;
      if (!['flex','inline-flex','grid','inline-grid'].includes(display)) continue;
      const hosts = new Set();
      const entries = [];
      for (const card of cards) {
        let host = card;
        while (host.parentElement && host.parentElement !== layout) host = host.parentElement;
        if (host.parentElement !== layout || hosts.has(host)) break;
        hosts.add(host);
        entries.push({ host, card });
      }
      if (entries.length === cards.length) return entries;
    }
    return null;
  }
  function sortRenderedNativeCards() {
    // CSS fallback only when the complete native list is already rendered.
    // Never scroll the page or turn an incomplete DOM into a fake full sort.
    if (reactiveApplied || !videos || mode === 'default') return;
    const entries = scanNativeEntries();
    if (!entries || entries.length !== videos.length) return;
    const ranks = ranksFromVideos(videos, mode, sortVideos);
    const matched = matchNativeEntries(entries, ranks, videos.length);
    if (!matched.complete) return;
    const current = new Set(entries.map(x => x.host));
    for (const [node, prior] of originalOrders) {
      if (current.has(node)) continue;
      if (prior.value) node.style.setProperty('order', prior.value, prior.priority);
      else node.style.removeProperty('order');
      originalOrders.delete(node);
    }
    for (const item of matched.ranked) {
      if (!originalOrders.has(item.host)) originalOrders.set(item.host, {
        value: item.host.style.getPropertyValue('order'),
        priority: item.host.style.getPropertyPriority('order')
      });
      item.host.style.setProperty('order', String(item.rank), 'important');
    }
  }
  async function getMetadata() {
    if (videos) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'WL_SORTER_FETCH' });
      if (response?.ok && Array.isArray(response.items) && response.count === response.items.length) {
        videos = response.items;
        if (mode !== 'default') sortRenderedNativeCards();
      }
    } catch {}
  }
  function apply() {
    if (!mount()) return;
    if (mode === 'default' || reactiveApplied) {
      resetInlineOrders();
    } else {
      sortRenderedNativeCards();
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; apply(); }, 100);
  }
  function setMode(value) {
    if (!isSortMode(value)) return;
    mode = value;
    reactiveApplied = false;
    resetInlineOrders();
    try { localStorage.setItem(STORE, mode); } catch {}
    select.value = mode;
    const id = String(++requestId);
    window.postMessage({ channel: CHANNEL, type: 'SET_MODE', mode, id }, location.origin);
    if (mode !== 'default') {
      void getMetadata();
    }
    schedule();
  }
  select.addEventListener('change', () => setMode(select.value));
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const payload = event.data;
    if (payload?.channel !== CHANNEL || payload.type !== 'MODE_RESULT' ||
        payload.id !== String(requestId)) return;
    reactiveApplied = payload.applied === true;
    if (reactiveApplied) resetInlineOrders();
    schedule();
  });
  window.addEventListener('hashchange', schedule);
  window.addEventListener('popstate', schedule);
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'WL_SORTER_OPEN' && root.isConnected) select.focus();
  });
  new MutationObserver(records => {
    if (records.some(record =>
      !root.contains(record.target) && [...record.addedNodes, ...record.removedNodes].some(node => node !== root)
    )) schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });
  if (mode !== 'default') void getMetadata();
  schedule();
})();
