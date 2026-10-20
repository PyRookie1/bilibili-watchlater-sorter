(() => {
  'use strict';
  if (document.getElementById('wl-sorter-root')) return;
  const { sortVideos, isSortMode, formatDuration, formatPublished, coverLink } = globalThis.WatchLaterSort;
  const CHANNEL = 'wl-sorter-bilibili-v1';
  const STORAGE_KEY = 'wl-sorter-mode';
  const OPTIONS = [
    ['default', 'B站默认顺序'],
    ['published-desc', '发布时间：最新优先'],
    ['published-asc', '发布时间：最早优先'],
    ['duration-asc', '总时长：短到长'],
    ['duration-desc', '总时长：长到短']
  ];
  const BV_RE = /^BV[0-9a-zA-Z]{10}$/;
  let mode = 'default';
  let videos = null;
  let count = 0;
  let pending = null;
  let fetchError = null;
  let nativeGrid = null;
  let originalGridDisplay = null;
  let scheduled = false;
  let renderedMode = null;
  let renderedVideos = null;

  const root = document.createElement('div');
  root.id = 'wl-sorter-root';
  root.setAttribute('aria-label', '稍后再看全量排序工具');

  const label = document.createElement('label');
  label.className = 'wl-sorter-label';
  label.textContent = '扩展排序';
  const select = document.createElement('select');
  select.className = 'wl-sorter-select';
  select.setAttribute('aria-label', '对完整稍后再看列表排序');
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
  refresh.title = '重新获取完整列表';
  refresh.setAttribute('aria-label', '重新获取完整列表');
  const status = document.createElement('span');
  status.className = 'wl-sorter-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  root.append(label, refresh, status);

  const fullGrid = document.createElement('div');
  fullGrid.id = 'wl-sorter-full-list';
  fullGrid.setAttribute('aria-label', '按扩展规则排序的全部稍后再看视频');
  fullGrid.hidden = true;
  const warning = document.createElement('div');
  warning.id = 'wl-sorter-warning';
  warning.setAttribute('role', 'alert');
  warning.hidden = true;

  function setStatus(text, error = false) {
    if (status.textContent !== text) status.textContent = text;
    status.title = text;
    status.dataset.error = String(error);
  }
  function setWarning(text = '') {
    warning.textContent = text;
    warning.hidden = !text;
  }
  function isListPage() {
    if (!/^\/(?:watchlater(?:\/list)?|list\/watchlater)\/?$/.test(location.pathname)) return false;
    return !location.hash || /^#\/list(?:[/?#]|$)/.test(location.hash);
  }
  function findGrid() {
    return document.querySelector('.watchlater-list-container');
  }
  function findNativeSort(grid) {
    // Bilibili has used several kinds of dropdown trigger.
    const candidates = document.querySelectorAll('button, [role="button"], [class*="sort"], span');
    const gridBounds = grid.getBoundingClientRect();
    for (const el of candidates) {
      if (root.contains(el) || !el.isConnected) continue;
      const text = el.textContent?.replace(/[\s▼▽⌄▾∨]/g, '');
      if (text !== '最近添加' && text !== '最早添加') continue;
      const bounds = el.getBoundingClientRect();
      if (bounds.width && bounds.height && bounds.top <= gridBounds.top && bounds.left >= gridBounds.left) {
        return el.closest('button, [role="button"], [class*="dropdown"], [class*="sort"], [class*="select"]') || el;
      }
    }
    return null;
  }
  function restoreNative() {
    fullGrid.hidden = true;
    if (nativeGrid && originalGridDisplay) {
      const { value, priority } = originalGridDisplay;
      if (value) nativeGrid.style.setProperty('display', value, priority);
      else nativeGrid.style.removeProperty('display');
      originalGridDisplay = null;
    }
  }
  function hideNative() {
    if (!nativeGrid) return;
    if (!originalGridDisplay) {
      originalGridDisplay = {
        value: nativeGrid.style.getPropertyValue('display'),
        priority: nativeGrid.style.getPropertyPriority('display')
      };
    }
    nativeGrid.style.setProperty('display', 'none', 'important');
    fullGrid.hidden = false;
  }
  function mount() {
    const nextGrid = isListPage() ? findGrid() : null;
    if (!nextGrid) {
      restoreNative();
      root.remove();
      fullGrid.remove();
      warning.remove();
      nativeGrid = null;
      return false;
    }
    if (nextGrid !== nativeGrid) {
      restoreNative();
      nativeGrid = nextGrid;
      root.remove();
      fullGrid.remove();
      warning.remove();
    }
    const parent = nextGrid.parentElement;
    if (!parent) return false;
    if (warning.parentElement !== parent || warning.nextElementSibling !== fullGrid) {
      parent.insertBefore(warning, nextGrid.nextSibling);
      parent.insertBefore(fullGrid, warning.nextSibling);
    }
    if (!root.isConnected) {
      const nativeSort = findNativeSort(nextGrid);
      const host = nativeSort?.parentElement || parent;
      root.dataset.placement = nativeSort ? 'inline' : 'fallback';
      if (nativeSort) host.insertBefore(root, nativeSort);
      else host.insertBefore(root, nextGrid);
    }
    return true;
  }
  function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }
  function renderCard(item) {
    const article = make('article', 'wl-sorter-card');
    const key = typeof item.bvid === 'string' && BV_RE.test(item.bvid) ? item.bvid : null;
    const url = key ? 'https://www.bilibili.com/video/' + key :
      Number.isSafeInteger(item.aid) && item.aid > 0 ? 'https://www.bilibili.com/video/av' + item.aid : null;
    const link = url ? make('a', 'wl-sorter-link') : make('div', 'wl-sorter-link');
    if (url) {
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = '在新标签页打开视频';
    }
    const cover = make('div', 'wl-sorter-cover');
    const coverURL = coverLink(item.pic);
    if (coverURL) {
      const image = document.createElement('img');
      image.src = coverURL;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      cover.append(image);
    } else {
      cover.append(make('span', 'wl-sorter-placeholder', '无封面'));
    }
    cover.append(make('span', 'wl-sorter-duration', formatDuration(item.duration)));
    link.append(cover, make('span', 'wl-sorter-title', item.title || '视频已失效或标题缺失'));
    article.append(link);
    const metadata = make('div', 'wl-sorter-meta');
    metadata.append(make('span', 'wl-sorter-owner', item.owner || 'UP主未知'));
    metadata.append(make('span', 'wl-sorter-published', '发布 ' + formatPublished(item.pubdate)));
    article.append(metadata);
    return article;
  }
  function renderSortedList() {
    if (renderedMode === mode && renderedVideos === videos) return;
    const fragment = document.createDocumentFragment();
    const note = make('div', 'wl-sorter-note',
      '完整列表 ' + count + ' / ' + count + ' · 当前为扩展视图；原生搜索、筛选、删除及连播请切换回「B站默认顺序」。');
    fragment.append(note);
    for (const video of sortVideos(videos, mode)) fragment.append(renderCard(video));
    if (!videos.length) fragment.append(make('p', 'wl-sorter-empty', '稍后再看列表为空'));
    fullGrid.replaceChildren(fragment);
    renderedMode = mode;
    renderedVideos = videos;
  }
  function syncView() {
    if (!mount()) return;
    if (mode === 'default') {
      restoreNative();
      setWarning();
      setStatus('原生列表');
      return;
    }
    if (!videos) {
      restoreNative();
      setStatus(fetchError ? '全量获取失败' : '读取完整列表中…', Boolean(fetchError));
      if (fetchError) setWarning(fetchError + '。已保留 B 站原始列表，请点击刷新重试。');
      return;
    }
    // Fail closed: never disguise an incomplete response as a complete list.
    if (count !== videos.length) {
      restoreNative();
      setWarning('接口返回 ' + videos.length + ' / ' + count + ' 条，未启用全量排序。');
      setStatus('列表不完整', true);
      return;
    }
    setWarning();
    renderSortedList();
    hideNative();
    setStatus('已全量排序 ' + videos.length + '/' + count);
  }
  function fetchFromPage() {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      let finished = false;
      const timer = setTimeout(() => finish(new Error('页面请求超时')), 35000);
      function finish(error, result) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (error) reject(error); else resolve(result);
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
    let primaryError = '扩展后台读取失败';
    try {
      const result = await chrome.runtime.sendMessage({ type: 'WL_SORTER_FETCH' });
      if (result?.ok && Array.isArray(result.items) && result.count === result.items.length) return result;
      primaryError = result?.error || '后台接口未返回完整列表';
    } catch (error) {
      primaryError = error instanceof Error ? error.message : primaryError;
    }
    try {
      const result = await fetchFromPage();
      if (result?.ok && Array.isArray(result.items) && result.count === result.items.length) return result;
      throw new Error(result?.error || '页面接口未返回完整列表');
    } catch (error) {
      throw new Error(primaryError + '；备用方式：' + (error instanceof Error ? error.message : '失败'));
    }
  }
  async function loadData(force = false) {
    if (pending) return pending;
    if (!force && videos !== null) return;
    fetchError = null;
    setWarning();
    refresh.disabled = true;
    setStatus('读取完整列表中…');
    pending = (async () => {
      try {
        const result = await fetchList();
        videos = result.items;
        count = result.count;
      } catch (error) {
        fetchError = error instanceof Error ? error.message : '未知错误';
        if (force) {
          // Do not continue to display a stale "complete" view after refresh failed.
          videos = null;
          renderedVideos = null;
        }
      } finally {
        pending = null;
        refresh.disabled = false;
        syncView();
      }
    })();
    return pending;
  }
  function sync() {
    syncView();
    if (mode !== 'default' && !videos && !pending && !fetchError && nativeGrid)
      void loadData();
  }
  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      sync();
    }, 150);
  }
  select.addEventListener('change', () => {
    mode = isSortMode(select.value) ? select.value : 'default';
    chrome.storage.local.set({ [STORAGE_KEY]: mode }).catch(() => {});
    sync();
  });
  refresh.addEventListener('click', () => { void loadData(true); });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'WL_SORTER_OPEN') {
      sync();
      if (root.isConnected) select.focus();
    }
  });
  window.addEventListener('hashchange', scheduleSync);
  window.addEventListener('popstate', scheduleSync);
  new MutationObserver(records => {
    if (records.some(record => !root.contains(record.target) &&
        !fullGrid.contains(record.target) && !warning.contains(record.target) &&
        [...record.addedNodes, ...record.removedNodes].some(node =>
          node !== root && node !== fullGrid && node !== warning)))
      scheduleSync();
  }).observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.local.get(STORAGE_KEY).then(saved => {
    if (isSortMode(saved?.[STORAGE_KEY])) mode = saved[STORAGE_KEY];
    select.value = mode;
    sync();
  }).catch(() => sync());
  scheduleSync();
})();
