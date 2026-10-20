(() => {
  'use strict';
  if (document.getElementById('wl-sorter-root')) return;
  const { sortVideos, isSortMode } = globalThis.WatchLaterSort;
  const { ranksFromVideos, matchNativeEntries } = globalThis.WatchLaterNativeSort;
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
  let total = 0;
  let nativeGrid = null;
  let pending = null;
  let state = 'idle';
  let operation = 0;
  let scheduled = false;
  const originalOrders = new Map();

  const root = document.createElement('div');
  root.id = 'wl-sorter-root';
  root.setAttribute('aria-label', '稍后再看原生列表排序');
  const label = document.createElement('label');
  label.className = 'wl-sorter-label';
  label.textContent = '扩展排序';
  const select = document.createElement('select');
  select.className = 'wl-sorter-select';
  select.setAttribute('aria-label', '对完整稍后再看列表进行原生卡片排序');
  for (const [value, name] of OPTIONS) {
    const item = document.createElement('option');
    item.value = value;
    item.textContent = name;
    select.append(item);
  }
  label.append(select);
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'wl-sorter-refresh';
  refresh.title = '重新获取全部视频并排序';
  refresh.setAttribute('aria-label', '刷新完整列表');
  refresh.textContent = '↻';
  const status = document.createElement('span');
  status.className = 'wl-sorter-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  root.append(label, refresh, status);

  // This is a temporary opaque loading curtain, not a replacement video view.
  // Bilibili must keep its native cards visible to IntersectionObserver while we
  // trigger lazy loading, so we mask viewport movement until sorting is finished.
  const preparation = document.createElement('div');
  preparation.id = 'wl-sorter-preparing';
  preparation.hidden = true;
  preparation.setAttribute('role', 'dialog');
  preparation.setAttribute('aria-modal', 'true');
  preparation.setAttribute('aria-labelledby', 'wl-sorter-progress-title');
  const preparationPanel = document.createElement('div');
  preparationPanel.className = 'wl-sorter-preparing-panel';
  const preparationTitle = document.createElement('strong');
  preparationTitle.id = 'wl-sorter-progress-title';
  preparationTitle.textContent = '正在准备原生视频列表';
  const preparationText = document.createElement('p');
  preparationText.className = 'wl-sorter-preparing-text';
  preparationText.setAttribute('role', 'status');
  preparationText.setAttribute('aria-live', 'polite');
  preparationText.textContent = '等待原生卡片加载…';
  const preparationCancel = document.createElement('button');
  preparationCancel.type = 'button';
  preparationCancel.textContent = '取消';
  preparationPanel.append(preparationTitle, preparationText, preparationCancel);
  preparation.append(preparationPanel);
  let previousFocus = null;

  function showPreparation() {
    previousFocus = document.activeElement;
    document.documentElement.append(preparation);
    preparation.hidden = false;
    preparationCancel.focus({ preventScroll: true });
  }
  function updatePreparation(current, expected) {
    preparationText.textContent = '正在加载原生卡片 ' + current + ' / ' + expected +
      '。加载完成后会直接显示排序结果。';
  }
  function hidePreparation() {
    if (preparation.hidden) return;
    preparation.hidden = true;
    preparation.remove();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    previousFocus = null;
  }
  preparationCancel.addEventListener('click', () => {
    if (state !== 'loading') return;
    operation++;
    state = 'failed';
    setStatus('已取消自动加载，请点击刷新重试', true);
  });
  preparation.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      preparationCancel.click();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      preparationCancel.focus({ preventScroll: true });
    }
  });

  function setStatus(text, isError = false) {
    status.textContent = text;
    status.title = text;
    status.dataset.error = String(isError);
  }
  function isListPage() {
    if (!/^\/(?:watchlater(?:\/list)?|list\/watchlater)\/?$/.test(location.pathname)) return false;
    return !location.hash || /^#\/list(?:[/?#]|$)/.test(location.hash);
  }
  function findGrid() {
    return document.querySelector('.watchlater-list-container');
  }
  function findNativeSort(grid) {
    const gridTop = grid.getBoundingClientRect().top;
    for (const element of document.querySelectorAll('button, [role="button"], [class*="sort"], span')) {
      if (root.contains(element)) continue;
      const text = element.textContent?.replace(/[\s▼▽⌄▾∨]/g, '');
      if (text !== '最近添加' && text !== '最早添加') continue;
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height || bounds.top > gridTop) continue;
      return element.closest('button, [role="button"], [class*="dropdown"], [class*="sort"], [class*="select"]') || element;
    }
    return null;
  }
  function restoreNativeOrders() {
    for (const [node, prior] of originalOrders) {
      if (prior.value) node.style.setProperty('order', prior.value, prior.priority);
      else node.style.removeProperty('order');
    }
    originalOrders.clear();
  }
  function mount() {
    const grid = isListPage() ? findGrid() : null;
    if (!grid) {
      if (nativeGrid) {
        operation++;
        state = 'idle';
        restoreNativeOrders();
      }
      nativeGrid = null;
      root.remove();
      return false;
    }
    if (nativeGrid !== grid) {
      operation++;
      state = 'idle';
      restoreNativeOrders();
      nativeGrid = grid;
      root.remove();
    }
    if (!root.isConnected) {
      const nativeSort = findNativeSort(grid);
      const host = nativeSort?.parentElement || grid.parentElement;
      if (!host) return false;
      root.dataset.placement = nativeSort ? 'inline' : 'fallback';
      if (nativeSort) host.insertBefore(root, nativeSort);
      else host.insertBefore(root, grid);
    }
    return true;
  }
  function scanCards() {
    if (!nativeGrid?.isConnected) return null;
    const cards = [...nativeGrid.querySelectorAll('.video-card')];
    if (!cards.length) return { count: 0, entries: [], layout: null };
    // Find a flex/grid parent with one native card per direct child.
    let layout = cards[0].parentElement;
    while (layout && (layout === nativeGrid || nativeGrid.contains(layout))) {
      const entries = [];
      const hosts = new Set();
      for (const card of cards) {
        let host = card;
        while (host.parentElement && host.parentElement !== layout) host = host.parentElement;
        if (host.parentElement !== layout || hosts.has(host)) break;
        hosts.add(host);
        entries.push({ card, host });
      }
      const display = getComputedStyle(layout).display;
      if (entries.length === cards.length && ['grid', 'inline-grid', 'flex', 'inline-flex'].includes(display)) {
        return { count: cards.length, entries, layout };
      }
      layout = layout.parentElement;
    }
    return { count: cards.length, entries: [], layout: null };
  }
  function applyOrder() {
    if (!videos || !nativeGrid) return false;
    if (total === 0) {
      setStatus('原生列表 0/0');
      return true;
    }
    const scanned = scanCards();
    if (!scanned || !scanned.layout || scanned.count !== total) return false;
    const ranks = ranksFromVideos(videos, mode, sortVideos);
    const mapping = matchNativeEntries(scanned.entries, ranks, total);
    if (!mapping.complete) return false;
    const current = new Set(scanned.entries.map(entry => entry.host));
    for (const [node, prior] of originalOrders) {
      if (!current.has(node)) {
        if (prior.value) node.style.setProperty('order', prior.value, prior.priority);
        else node.style.removeProperty('order');
        originalOrders.delete(node);
      }
    }
    mapping.ranked.forEach(({ host, rank }) => {
      if (!originalOrders.has(host)) originalOrders.set(host, {
        value: host.style.getPropertyValue('order'),
        priority: host.style.getPropertyPriority('order')
      });
      host.style.setProperty('order', String(rank), 'important');
    });
    setStatus('原生列表已全量排序 ' + total + '/' + total);
    return true;
  }
  function readDisplayedTotal() {
    const text = document.body?.innerText || '';
    const match = text.slice(0, 3500).match(/稍后再看\s*[·:：]?\s*(\d{1,6})(?!\d)/);
    return match ? Number(match[1]) : null;
  }
  function fetchFromPage(expectedCount) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      let settled = false;
      const timer = setTimeout(() => finish(new Error('页面请求超时')), 35000);
      function finish(err, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', receive);
        if (err) reject(err); else resolve(value);
      }
      function receive(event) {
        if (event.source !== window || event.origin !== location.origin) return;
        const data = event.data;
        if (data?.channel === CHANNEL && data.type === 'RESPONSE' && data.id === id)
          finish(null, data.payload);
      }
      window.addEventListener('message', receive);
      window.postMessage({ channel: CHANNEL, type: 'REQUEST', id, expectedCount }, location.origin);
    });
  }
  async function fetchCompleteList() {
    const expectedCount = readDisplayedTotal();
    const valid = data => data?.ok && Array.isArray(data.items) && data.count === data.items.length &&
      (expectedCount === null || expectedCount === data.count);
    let firstError = '后台请求失败';
    try {
      const data = await chrome.runtime.sendMessage({ type: 'WL_SORTER_FETCH', expectedCount });
      if (valid(data)) return data;
      firstError = data?.error || '后台返回数量不完整';
    } catch (error) { firstError = String(error?.message || error); }
    try {
      const data = await fetchFromPage(expectedCount);
      if (valid(data)) return data;
      throw new Error(data?.error || '页面请求返回数量不完整');
    } catch (error) {
      throw new Error(firstError + '；备用接口：' + (error?.message || error));
    }
  }
  function findScroller(node) {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight + 40)
        return parent;
    }
    return document.scrollingElement || document.documentElement;
  }
  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  async function materializeNativeCards(token) {
    let scanned = scanCards();
    if (scanned?.layout && scanned.count === total) return;
    // Trigger Bilibili's own lazy-loading. Do not create or replace native cards.
    const scroller = findScroller(nativeGrid);
    const startTop = scroller.scrollTop;
    const initialBehavior = scroller.style.getPropertyValue('scroll-behavior');
    const initialPriority = scroller.style.getPropertyPriority('scroll-behavior');
    let interrupted = false;
    const onUserInput = event => { if (event.isTrusted) interrupted = true; };
    window.addEventListener('wheel', onUserInput, { passive: true });
    window.addEventListener('touchstart', onUserInput, { passive: true });
    scroller.style.setProperty('scroll-behavior', 'auto', 'important');
    try {
      let unchangedAtEnd = 0;
      let lastCount = -1;
      for (let i = 0; i < 150; i++) {
        if (token !== operation || mode === 'default') return;
        if (interrupted) throw new Error('用户中断了自动加载，请点击刷新重试');
        scanned = scanCards();
        if (scanned?.layout && scanned.count === total) return;
        if (scanned && scanned.count > total)
          throw new Error('原生页面卡片数超过列表总数，请关闭筛选后重试');
        updatePreparation(scanned?.count || 0, total);
        const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const nextTop = Math.min(maxTop, scroller.scrollTop + Math.max(700, Math.floor(scroller.clientHeight * 1.5)));
        if (nextTop > scroller.scrollTop) scroller.scrollTop = nextTop;
        await sleep(nextTop >= maxTop ? 300 : 120);
        const after = scanCards()?.count || 0;
        if (scroller.scrollTop >= Math.max(0, scroller.scrollHeight - scroller.clientHeight - 3)) {
          unchangedAtEnd = after === lastCount ? unchangedAtEnd + 1 : 0;
          if (unchangedAtEnd >= 12) break;
        } else unchangedAtEnd = 0;
        lastCount = after;
      }
    } finally {
      if (initialBehavior) scroller.style.setProperty('scroll-behavior', initialBehavior, initialPriority);
      else scroller.style.removeProperty('scroll-behavior');
      // Never expose the intermediate scroll position, including cancellations.
      scroller.scrollTop = startTop;
      window.removeEventListener('wheel', onUserInput);
      window.removeEventListener('touchstart', onUserInput);
    }
  }
  async function runSort() {
    if (pending || !nativeGrid || mode === 'default' || state !== 'idle') return;
    const token = ++operation;
    state = 'loading';
    refresh.disabled = true;
    pending = (async () => {
      try {
        if (!videos) {
          setStatus('正在获取完整视频数据…');
          const result = await fetchCompleteList();
          if (token !== operation || mode === 'default') return;
          videos = result.items;
          total = result.count;
        }
        const shown = readDisplayedTotal();
        if (shown !== null && shown !== total)
          throw new Error('列表总数发生变化，请点击刷新重新读取');
        if (!applyOrder()) {
          // Mount before changing scrollTop. Native cards remain live behind the
          // curtain so Bilibili can create their actual components.
          showPreparation();
          await materializeNativeCards(token);
        }
        if (token !== operation || mode === 'default') return;
        if (!applyOrder()) {
          const count = scanCards()?.count || 0;
          throw new Error('原生卡片未能全部加载或匹配：' + count + '/' + total + '；无法安全全量排序');
        }
        state = 'ready';
        // Paint the final native CSS order before revealing the viewport.
        if (!preparation.hidden) {
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }
      } catch (error) {
        if (token !== operation || mode === 'default') return;
        restoreNativeOrders();
        state = 'failed';
        setStatus(error?.message || '原生列表全量排序失败', true);
      }
    })().finally(() => {
      hidePreparation();
      pending = null;
      refresh.disabled = false;
      scheduleSync();
    });
    return pending;
  }
  function sync() {
    if (!mount()) return;
    if (mode === 'default') {
      restoreNativeOrders();
      setStatus('B站默认顺序');
      return;
    }
    if (state === 'ready') {
      if (!applyOrder()) {
        restoreNativeOrders();
        state = 'failed';
        setStatus('原生卡片或列表数据发生变化，请点击刷新重新排序', true);
      }
    } else if (state === 'idle' && !pending) void runSort();
  }
  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; sync(); }, 150);
  }
  function changeMode(next) {
    mode = isSortMode(next) ? next : 'default';
    operation++;
    state = 'idle';
    restoreNativeOrders();
    select.value = mode;
    chrome.storage.local.set({ [STORAGE_KEY]: mode }).catch(() => {});
    scheduleSync();
  }
  select.addEventListener('change', () => changeMode(select.value));
  refresh.addEventListener('click', () => {
    operation++;
    state = 'idle';
    videos = null;
    total = 0;
    restoreNativeOrders();
    scheduleSync();
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'WL_SORTER_OPEN') { scheduleSync(); select.focus(); }
  });
  window.addEventListener('hashchange', scheduleSync);
  window.addEventListener('popstate', scheduleSync);
  new MutationObserver(records => {
    if (records.some(record => !root.contains(record.target) &&
      !preparation.contains(record.target) &&
      (record.type === 'attributes' ||
        [...record.addedNodes, ...record.removedNodes].some(node => node !== root && node !== preparation)))) scheduleSync();
  }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'data-bvid']
  });
  chrome.storage.local.get(STORAGE_KEY).then(saved => {
    if (isSortMode(saved?.[STORAGE_KEY])) mode = saved[STORAGE_KEY];
    select.value = mode;
    scheduleSync();
  }).catch(scheduleSync);
  scheduleSync();
})();
