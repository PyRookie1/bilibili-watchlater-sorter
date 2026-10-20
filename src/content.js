(() => {
  'use strict';
  if (document.getElementById('wl-sorter-root')) return;
  const { sortVideos, isSortMode } = globalThis.WatchLaterSort;
  const { rankMap, displayOrders } = globalThis.WatchLaterNativeSort;
  const CHANNEL = 'wl-sorter-bilibili-v1';
  const STORAGE_KEY = 'wl-sorter-mode';
  const OPTIONS = [
    ['default', 'B站默认顺序'],
    ['published-desc', '发布时间：最新优先'],
    ['published-asc', '发布时间：最早优先'],
    ['duration-asc', '总时长：短到长'],
    ['duration-desc', '总时长：长到短']
  ];

  let mode = 'default';
  let videos = null;
  let count = 0;
  let pending = null;
  let grid = null;
  let scheduled = false;
  let lastNodes = new Set();
  const originalOrders = new WeakMap();

  const root = document.createElement('div');
  root.id = 'wl-sorter-root';
  root.className = 'wl-sorter-toolbar';
  root.setAttribute('aria-label', '扩展视频排序工具');

  const label = document.createElement('label');
  label.className = 'wl-sorter-label';
  label.textContent = '扩展排序';
  const select = document.createElement('select');
  select.className = 'wl-sorter-select';
  select.setAttribute('aria-label', '按发布时间或视频时长排序');
  for (const [value, text] of OPTIONS) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    select.append(option);
  }
  label.append(select);

  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'wl-sorter-refresh';
  refresh.textContent = '↻';
  refresh.title = '刷新排序数据';
  refresh.setAttribute('aria-label', '刷新排序数据');

  const status = document.createElement('span');
  status.className = 'wl-sorter-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  root.append(label, refresh, status);

  function setStatus(text, error = false) {
    if (status.textContent !== text) status.textContent = text;
    status.title = text;
    status.dataset.error = error ? 'true' : 'false';
  }
  function isListPage() {
    if (!/^\/(?:watchlater(?:\/list)?|list\/watchlater)\/?$/.test(location.pathname)) return false;
    return !location.hash || /^#\/list(?:[/?#]|$)/.test(location.hash);
  }
  function findGrid() {
    return document.querySelector('.watchlater-list-container');
  }
  function findNativeSort(gridNode) {
    // Text-based fallback because Bilibili changes CSS class names.
    const candidates = [...document.querySelectorAll('button, [role="button"], [class*="sort"]')];
    for (const element of candidates) {
      if (root.contains(element) || element.closest('#wl-sorter-root')) continue;
      const text = element.textContent?.replace(/[\s▼▽⌄▾∨]/g, '');
      if (text !== '最近添加' && text !== '最早添加') continue;
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      const gridBounds = gridNode.getBoundingClientRect();
      if (bounds.top > gridBounds.top || bounds.left < gridBounds.left) continue;
      return element;
    }
    // Some Bilibili versions render the native sort label as a plain span.
    // Find the visible label above the video grid, then insert beside its control.
    for (const label of document.querySelectorAll('span')) {
      if (root.contains(label)) continue;
      const text = label.textContent?.replace(/[\\s▼▽⌄▾∨]/g, '');
      if (text !== '最近添加' && text !== '最早添加') continue;
      const rect = label.getBoundingClientRect();
      const gridRect = gridNode.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.top > gridRect.top ||
          rect.left < gridRect.left) continue;
      return label.closest('button, [role="button"], [class*="dropdown"], [class*="sort"], [class*="select"]') || label;
    }
    return null;
  }
  function mount() {
    const currentGrid = isListPage() ? findGrid() : null;
    if (!currentGrid) {
      if (root.isConnected) root.remove();
      if (grid) restoreOrders();
      grid = null;
      return false;
    }
    if (grid !== currentGrid) {
      restoreOrders();
      grid = currentGrid;
    }
    const nativeSort = findNativeSort(grid);
    const host = nativeSort?.parentElement || grid.parentElement;
    if (!host) return false;
    root.dataset.placement = nativeSort ? 'inline' : 'fallback';
    if (nativeSort) {
      if (root.parentNode !== host || root.nextElementSibling !== nativeSort)
        host.insertBefore(root, nativeSort);
    } else if (root.parentNode !== host || root.nextElementSibling !== grid) {
      host.insertBefore(root, grid);
    }
    return true;
  }
  function restoreOrder(node) {
    if (!originalOrders.has(node)) return;
    const prior = originalOrders.get(node);
    if (prior.value) node.style.setProperty('order', prior.value, prior.priority);
    else node.style.removeProperty('order');
    originalOrders.delete(node);
  }
  function restoreOrders() {
    for (const node of lastNodes) restoreOrder(node);
    lastNodes = new Set();
  }
  function cardsInGrid(container) {
    return [...container.children].map(host => ({
      host,
      card: host.matches('.video-card') ? host : host.querySelector('.video-card')
    })).filter(entry => entry.card);
  }
  function applySort() {
    if (!grid || !grid.isConnected) return;
    const entries = cardsInGrid(grid);
    if (mode === 'default') {
      restoreOrders();
      setStatus('使用B站原有顺序');
      return;
    }
    if (!entries.length) {
      setStatus('等待视频卡片加载…');
      return;
    }
    const display = getComputedStyle(grid).display;
    if (!['grid', 'inline-grid', 'flex', 'inline-flex'].includes(display)) {
      restoreOrders();
      setStatus('列表布局不是网格或弹性布局，无法安全排序', true);
      return;
    }
    if (!videos) {
      setStatus('正在读取视频元数据…');
      return;
    }
    const ranks = rankMap(videos, mode, sortVideos);
    const positions = displayOrders(entries.map(entry => entry.card), ranks, videos.length);
    const matched = positions.filter(item => item.matched).length;
    if (!matched) {
      restoreOrders();
      setStatus('卡片未匹配到BV号，未修改列表顺序', true);
      return;
    }
    const newest = new Set();
    positions.forEach((item, index) => {
      const node = entries[index].host;
      if (!originalOrders.has(node)) {
        originalOrders.set(node, {
          value: node.style.getPropertyValue('order'),
          priority: node.style.getPropertyPriority('order')
        });
      }
      node.style.setProperty('order', String(item.order));
      newest.add(node);
    });
    for (const node of lastNodes) if (!newest.has(node)) restoreOrder(node);
    lastNodes = newest;
    if (count && entries.length < count) {
      setStatus('已排序已加载卡片 ' + matched + '/' + entries.length + '（列表共 ' + count + ' 项）');
    } else {
      setStatus('已排序 ' + matched + '/' + entries.length + ' 张卡片');
    }
  }
  function fetchFromPage() {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => finish(new Error('页面请求超时')), 17000);
      let complete = false;
      function finish(error, result) {
        if (complete) return;
        complete = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (error) reject(error);
        else resolve(result);
      }
      function onMessage(event) {
        if (event.source !== window || event.origin !== location.origin) return;
        const data = event.data;
        if (data?.channel === CHANNEL && data.type === 'RESPONSE' && data.id === id)
          finish(null, data.payload);
      }
      window.addEventListener('message', onMessage);
      window.postMessage({ channel: CHANNEL, type: 'REQUEST', id }, location.origin);
    });
  }
  async function fetchList() {
    let firstError = '扩展后台接口请求失败';
    try {
      const response = await chrome.runtime.sendMessage({ type: 'WL_SORTER_FETCH' });
      if (response?.ok && Array.isArray(response.items)) return response;
      firstError = response?.error || firstError;
    } catch (error) {
      firstError = error instanceof Error ? error.message : firstError;
    }
    try {
      const response = await fetchFromPage();
      if (response?.ok && Array.isArray(response.items)) return response;
      throw new Error(response?.error || '读取失败');
    } catch (error) {
      throw new Error(firstError + '；页面请求：' +
        (error instanceof Error ? error.message : '未知错误'));
    }
  }
  async function loadData(force = false) {
    if (!force && videos !== null) return;
    if (pending) return pending;
    refresh.disabled = true;
    setStatus('正在读取视频元数据…');
    pending = (async () => {
      try {
        const result = await fetchList();
        videos = result.items;
        count = Number.isFinite(result.count) ? result.count : videos.length;
      } catch (error) {
        setStatus('读取失败：' + (error instanceof Error ? error.message : '未知错误'), true);
        if (videos === null) restoreOrders();
        return;
      } finally {
        refresh.disabled = false;
        pending = null;
      }
      applySort();
    })();
    return pending;
  }
  function sync() {
    if (!mount()) return;
    applySort();
    if (mode !== 'default' && videos === null && !pending) void loadData();
  }
  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      sync();
    }, 150);
  }
  async function updateMode(next) {
    mode = isSortMode(next) ? next : 'default';
    select.value = mode;
    try { await chrome.storage.local.set({ [STORAGE_KEY]: mode }); } catch {}
    sync();
  }
  select.addEventListener('change', () => { void updateMode(select.value); });
  refresh.addEventListener('click', () => { void loadData(true); });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== 'WL_SORTER_OPEN') return;
    scheduleSync();
    select.focus();
  });
  window.addEventListener('hashchange', scheduleSync);
  window.addEventListener('popstate', scheduleSync);
  new MutationObserver(records => {
    if (records.some(record => !root.contains(record.target) &&
      (record.type === 'attributes' ||
       [...record.addedNodes, ...record.removedNodes].some(node => node !== root))))
      scheduleSync();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href', 'data-bvid']
  });
  chrome.storage.local.get(STORAGE_KEY).then(saved => {
    if (isSortMode(saved?.[STORAGE_KEY])) mode = saved[STORAGE_KEY];
    select.value = mode;
    sync();
  }).catch(() => sync());
  scheduleSync();
})();
