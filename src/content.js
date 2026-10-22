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
    ['published-desc', '最新发布', '按发布时间从新到旧排序'],
    ['published-asc', '最早发布', '按发布时间从旧到新排序'],
    ['duration-asc', '时长最短', '按视频时长从短到长排序'],
    ['duration-desc', '时长最长', '按视频时长从长到短排序']
  ];
  const NATIVE_CAPTIONS = new Set(['最近添加', '最早添加']);
  let mode = null;
  let cached = null;
  let dataPromise = null;
  let cacheEpoch = 0;
  let nativeGrid = null;
  let nativeAnchor = null;
  let preparedGrid = null;
  let scheduled = false;
  let revision = 0;
  let activeDates = null;

  const root = document.createElement('div');
  root.id = 'wl-sorter-root';
  const buttons = new Map();
  const error = document.createElement('span');
  error.className = 'wl-sorter-error';
  error.setAttribute('role', 'status');
  error.hidden = true;

  function captionOf(element) {
    return element?.textContent?.replace(/[\s▼▽⌄▾∨]/g, '').trim() || '';
  }
  function nativeCaption(target) {
    for (let node = target; node && node !== document.documentElement; node = node.parentElement) {
      const caption = captionOf(node);
      if (NATIVE_CAPTIONS.has(caption)) return caption;
      if (caption.length > 25 || node === nativeGrid) break;
    }
    return null;
  }
  function report(message = '') {
    error.textContent = message;
    error.title = message;
    error.hidden = !message;
    for (const button of buttons.values())
      button.title = message || button.dataset.wlSorterTitle;
  }
  function updateButtons() {
    for (const [value, button] of buttons) {
      const active = value === mode;
      button.classList.toggle('wl-sorter-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }
  function setBusy(busy) {
    for (const button of buttons.values()) {
      if ('disabled' in button) button.disabled = busy;
      button.setAttribute('aria-disabled', String(busy));
      button.classList.toggle('wl-sorter-busy', busy);
    }
  }
  function isListPage() {
    return /^\/(?:watchlater(?:\/list)?|list\/watchlater)\/?$/.test(location.pathname) &&
      (!location.hash || /^#\/list(?:[/?#]|$)/.test(location.hash));
  }
  function findAnchor(grid) {
    const y = grid.getBoundingClientRect().top;
    const matches = [];
    const seen = new Set();
    for (const element of document.querySelectorAll('button, [role="button"], [class*="sort"], span, div, li')) {
      if (root.contains(element) || !NATIVE_CAPTIONS.has(captionOf(element))) continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.top > y || y - rect.bottom > 220) continue;
      let control = element;
      for (let parent = control.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (parent.contains(grid) || captionOf(parent) !== captionOf(element)) break;
        if (parent.getBoundingClientRect().width > 280) break;
        control = parent;
      }
      if (!seen.has(control)) {
        seen.add(control);
        matches.push({ control, caption: captionOf(element) });
      }
    }
    const recent = matches.find(item => item.caption === '最近添加');
    const oldest = matches.find(item => item.caption === '最早添加');
    if (recent && oldest && recent.control.parentElement === oldest.control.parentElement)
      return recent.control.compareDocumentPosition(oldest.control) & Node.DOCUMENT_POSITION_FOLLOWING
        ? oldest.control : recent.control;
    return recent?.control || oldest?.control || null;
  }
  function cloneButton(template, caption, value, title) {
    const button = template ? template.cloneNode(true) : document.createElement('button');
    const oldCaption = captionOf(template);
    const elements = [button, ...button.querySelectorAll('*')];
    for (const element of elements) {
      element.removeAttribute('id');
      element.removeAttribute('href');
      element.removeAttribute('aria-selected');
      element.removeAttribute('aria-expanded');
      element.removeAttribute('aria-haspopup');
      element.removeAttribute('aria-checked');
      element.removeAttribute('disabled');
      element.classList?.remove('active', 'selected', 'is-active', 'on');
      for (const attr of [...element.attributes])
        if (/^on/i.test(attr.name)) element.removeAttribute(attr.name);
    }
    const textTarget = elements.filter(node => captionOf(node) === oldCaption).at(-1) || button;
    textTarget.textContent = caption;
    button.classList.add('wl-sorter-button');
    button.dataset.wlSorterMode = value;
    button.dataset.wlSorterTitle = title;
    button.title = title;
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', title);
    button.setAttribute('aria-pressed', 'false');
    button.tabIndex = 0;
    if (button.tagName === 'BUTTON') button.type = 'button';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (button.getAttribute('aria-disabled') === 'true') return;
      void choose(value);
    });
    if (button.tagName !== 'BUTTON') {
      button.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          button.click();
        }
      });
    }
    return button;
  }
  function mount() {
    const grid = isListPage() ? document.querySelector('.watchlater-list-container') : null;
    if (grid !== nativeGrid) {
      dateOverlay.clear(nativeGrid);
      activeDates = null;
      revision++;
      mode = null;
      nativeGrid = grid;
      nativeAnchor = null;
      preparedGrid = null;
      root.remove();
    }
    if (!grid) { root.remove(); return false; }
    const anchor = findAnchor(grid);
    if (!root.isConnected || anchor !== nativeAnchor) {
      const host = anchor?.parentElement || grid.parentElement;
      if (!host) return false;
      root.remove();
      root.replaceChildren();
      buttons.clear();
      for (const [value, caption, title] of OPTIONS) {
        const button = cloneButton(anchor, caption, value, title);
        buttons.set(value, button);
        root.append(button);
      }
      root.append(error);
      root.dataset.placement = anchor ? 'inline' : 'fallback';
      if (anchor) host.insertBefore(root, anchor.nextSibling);
      else host.insertBefore(root, grid);
      nativeAnchor = anchor;
      updateButtons();
    }
    return true;
  }
  function returnToNative(event) {
    if (!nativeGrid || root.contains(event.target) || !nativeCaption(event.target)) return;
    revision++;
    mode = null;
    activeDates = null;
    dateOverlay.clear(nativeGrid);
    report('');
    updateButtons();
    setBusy(false);
  }
  document.addEventListener('click', returnToNative, true);

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
  async function fetchFullData(allowEarly = true) {
    if (allowEarly) {
      const early = await (globalThis.WatchLaterEarlyDataPromise || Promise.resolve(null));
      if (complete(early)) return early.items;
    }
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
  function fullData(fresh = false) {
    if (fresh) {
      // Sorting must use a current API snapshot, not document_start data.
      const epoch = ++cacheEpoch;
      cached = null;
      return fetchFullData(false).then(items => {
        if (epoch === cacheEpoch) cached = items;
        return items;
      });
    }
    if (cached) return Promise.resolve(cached);
    if (!dataPromise) {
      const epoch = cacheEpoch;
      dataPromise = fetchFullData(true).then(items => {
        // Late prefetch responses must not overwrite newer snapshots.
        if (epoch === cacheEpoch) cached = items;
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
    updateButtons();
    activeDates = null;
    dateOverlay.clear(nativeGrid);
    report('');
    // No stored preference: refreshing always opens in the Bilibili default mode.
    setBusy(true);
    try {
      if (!mount()) throw new Error('未找到 B站稍后再看原生列表');
      beginPreload();
      const items = await fullData(true);
      if (current !== revision) return;
      const result = await requestPage('SET_MODE', { mode: next, items }, 120000);
      if (current !== revision) return;
      if (!result?.ok)
        throw new Error(result?.error || '原生列表排序超时或页面脚本未响应');
      if (next === 'published-asc' || next === 'published-desc') {
        activeDates = dateOverlay.dateMap(items, formatPublished);
        showPublicationDates();
      }
      for (const button of buttons.values()) button.title = '已排序全部 ' + result.count + ' 条视频';
    } catch (reason) {
      if (current !== revision) return;
      cached = null;
      mode = null;
      updateButtons();
      report('全量排序失败：' + (reason?.message || reason));
    } finally {
      if (current === revision) setBusy(false);
    }
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'WL_SORTER_OPEN' && root.isConnected) buttons.values().next().value?.focus();
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
