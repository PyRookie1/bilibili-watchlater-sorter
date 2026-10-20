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
  try { const saved = localStorage.getItem(STORE); if (isSortMode(saved)) mode = saved; } catch {}
  let grid = null;
  let videos = null;
  let loadPromise = null;
  let revision = 0;
  let scheduled = false;
  let modified = new Map();
  let lastSuccess = false;

  const root = document.createElement('div');
  root.id = 'wl-sorter-root';
  const label = document.createElement('label');
  label.className = 'wl-sorter-label';
  label.textContent = '排序';
  const select = document.createElement('select');
  select.className = 'wl-sorter-select';
  select.setAttribute('aria-label', '稍后再看视频排序方式');
  for (const [value, text] of OPTIONS) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    select.append(option);
  }
  select.value = mode;
  label.append(select);
  const status = document.createElement('span');
  status.className = 'wl-sorter-error';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  root.append(label, status);

  function report(message = '') {
    status.textContent = message;
    status.hidden = !message;
    select.title = message || '对稍后再看视频排序';
  }
  function isListPage() {
    return /^\/(?:watchlater(?:\/list)?|list\/watchlater)\/?$/.test(location.pathname) &&
      (!location.hash || /^#\/list(?:[/?#]|$)/.test(location.hash));
  }
  function findGrid() {
    return isListPage() ? document.querySelector('.watchlater-list-container') : null;
  }
  function nativeSortAnchor(currentGrid) {
    const gridTop = currentGrid.getBoundingClientRect().top;
    for (const element of document.querySelectorAll('button, [role="button"], [class*="sort"], span')) {
      if (root.contains(element)) continue;
      const text = element.textContent?.replace(/[\s▼▽⌄▾∨]/g, '');
      if (text !== '最近添加' && text !== '最早添加') continue;
      const rect = element.getBoundingClientRect();
      if (!rect.height || !rect.width || rect.top > gridTop) continue;
      return element.closest('button,[role="button"],[class*="dropdown"],[class*="sort"],[class*="select"]') || element;
    }
    return null;
  }
  function restoreOrders() {
    for (const [node, original] of modified) {
      if (original.value) node.style.setProperty('order', original.value, original.priority);
      else node.style.removeProperty('order');
    }
    modified = new Map();
  }
  function mount() {
    const next = findGrid();
    if (next !== grid) {
      restoreOrders();
      grid = next;
      root.remove();
    }
    if (!next) { root.remove(); return false; }
    if (!root.isConnected) {
      const anchor = nativeSortAnchor(next);
      const host = anchor?.parentElement || next.parentElement;
      if (!host) return false;
      root.dataset.placement = anchor ? 'inline' : 'fallback';
      if (anchor) host.insertBefore(root, anchor);
      else host.insertBefore(root, next);
    }
    return true;
  }
  function scanNativeEntries() {
    if (!grid) return null;
    const cards = [...grid.querySelectorAll('.video-card')];
    if (!cards.length) return null;
    // CSS order works on direct children of a flex/grid container. Preserve Vue nodes.
    for (let layout = cards[0].parentElement; layout && grid.contains(layout); layout = layout.parentElement) {
      const display = getComputedStyle(layout).display;
      if (!['grid', 'inline-grid', 'flex', 'inline-flex'].includes(display)) continue;
      const seen = new Set(), entries = [];
      for (const card of cards) {
        let host = card;
        while (host.parentElement && host.parentElement !== layout) host = host.parentElement;
        if (host.parentElement !== layout || seen.has(host)) break;
        seen.add(host);
        entries.push({ host, card });
      }
      if (entries.length === cards.length) return entries;
    }
    return null;
  }
  function sortVisibleCards() {
    if (!videos || mode === 'default' || !grid) return { applied: false, matched: 0 };
    const entries = scanNativeEntries();
    if (!entries) return { applied: false, matched: 0 };
    const ranks = ranksFromVideos(videos, mode, sortVideos);
    const mapping = matchNativeEntries(entries, ranks, videos.length);
    if (!mapping.usable) return { applied: false, matched: mapping.matched };
    const current = new Set(entries.map(item => item.host));
    for (const [node, previous] of modified) {
      if (current.has(node)) continue;
      if (previous.value) node.style.setProperty('order', previous.value, previous.priority);
      else node.style.removeProperty('order');
      modified.delete(node);
    }
    for (const item of mapping.ranked) {
      if (!modified.has(item.host)) {
        modified.set(item.host, {
          value: item.host.style.getPropertyValue('order'),
          priority: item.host.style.getPropertyPriority('order')
        });
      }
      item.host.style.setProperty('order', String(item.order), 'important');
    }
    select.title = mapping.complete ? '已排序完整原生列表' :
      '已调整当前加载的 ' + mapping.matched + '/' + videos.length + ' 个视频；尚未加载的项目会在加载后继续应用顺序';
    return { applied: true, matched: mapping.matched, complete: mapping.complete };
  }
  function sendToPage(type, data = {}, timeoutMs = 1200) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => finish(null), timeoutMs);
      function finish(value) {
        clearTimeout(timer);
        window.removeEventListener('message', receive);
        resolve(value);
      }
      function receive(event) {
        if (event.source !== window || event.origin !== location.origin) return;
        const message = event.data;
        if (message?.channel !== CHANNEL || message.id !== id) return;
        if (!['MODE_RESULT', 'SNAPSHOT_RESULT', 'RESPONSE'].includes(message.type)) return;
        finish(message);
      }
      window.addEventListener('message', receive);
      window.postMessage({ channel: CHANNEL, type, id, ...data }, location.origin);
    });
  }
  function pageTotal() {
    const match = (document.body?.innerText || '').slice(0, 3500)
      .match(/稍后再看\s*[·:：]?\s*(\d{1,6})(?!\d)/);
    return match ? Number(match[1]) : null;
  }
  function isComplete(data, expected) {
    return data?.ok && Array.isArray(data.items) && Number.isSafeInteger(data.count) &&
      data.count === data.items.length && (expected === null || data.count === expected);
  }
  async function fetchMetadata() {
    const expected = pageTotal();
    // Prefer metadata captured from Bilibili's own request, then use the API.
    const snapshot = await sendToPage('GET_SNAPSHOT', {}, 300);
    if (Array.isArray(snapshot?.items) && snapshot.items.length &&
        (expected === null || snapshot.items.length === expected))
      return snapshot.items;
    let firstError = '扩展后台未返回完整列表';
    try {
      const result = await chrome.runtime.sendMessage({ type: 'WL_SORTER_FETCH', expectedCount: expected });
      if (isComplete(result, expected)) return result.items;
      firstError = result?.error || firstError;
    } catch (error) { firstError = error?.message || String(error); }
    const fallback = await sendToPage('REQUEST', { expectedCount: expected }, 35000);
    if (isComplete(fallback?.payload, expected)) return fallback.payload.items;
    throw new Error(firstError + '；页面请求：' +
      (fallback?.payload?.error || '未返回完整列表或超时'));
  }
  async function ensureMetadata() {
    if (videos) return videos;
    if (!loadPromise) {
      loadPromise = fetchMetadata().then(items => {
        videos = items;
        return items;
      }).finally(() => { loadPromise = null; });
    }
    return loadPromise;
  }
  async function choose(value) {
    if (!isSortMode(value)) return;
    const current = ++revision;
    mode = value;
    select.value = mode;
    try { localStorage.setItem(STORE, mode); } catch {}
    restoreOrders();
    report('');
    let list = videos;
    if (mode !== 'default') {
      // Never silently return when only a subset of Bilibili cards exists.
      try { list = await ensureMetadata(); }
      catch (error) {
        if (current === revision) report('排序失败：' + (error?.message || error));
        return;
      }
    }
    if (current !== revision || !isListPage()) return;
    // Show the ordering of available native cards immediately while the
    // page-world bridge attempts to update the complete reactive list.
    if (mode !== 'default') sortVisibleCards();
    // The page-world bridge can update the full Vue list even if Bilibili
    // fetches it via an endpoint unknown to the network interceptor.
    const response = await sendToPage('SET_MODE', {
      mode, items: list, count: list?.length
    }, 1800);
    if (current !== revision) return;
    if (response?.applied) {
      restoreOrders();
      lastSuccess = true;
      report('');
      return;
    }
    if (mode === 'default') {
      // Only original CSS styles are restored. Never force a reload.
      report('');
      lastSuccess = true;
      return;
    }
    const result = sortVisibleCards();
    lastSuccess = result.applied;
    if (!result.applied) {
      report('无法匹配原生视频卡片；当前页面排序未生效');
    } else {
      report('');
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      if (!mount() || mode === 'default' || !videos) return;
      const result = sortVisibleCards();
      if (result.applied) {
        lastSuccess = true;
        if (status.textContent === '无法匹配原生视频卡片；当前页面排序未生效') report('');
      }
    }, 120);
  }
  select.addEventListener('change', () => { void choose(select.value); });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'WL_SORTER_OPEN' && root.isConnected) select.focus();
  });
  window.addEventListener('hashchange', schedule);
  window.addEventListener('popstate', schedule);
  new MutationObserver(records => {
    if (records.some(record =>
      !root.contains(record.target) &&
      (record.type === 'attributes' ||
       [...record.addedNodes, ...record.removedNodes].some(node => node !== root))
    )) schedule();
  }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'data-bvid']
  });
  schedule();
  if (mode !== 'default') void choose(mode);
})();
