/* Native watch-later sort selector. Each page opens in Bilibili default order.
 * Full metadata and native records preload in parallel before a sort is chosen.
 */
(() => {
  'use strict';
  if (globalThis.__watchLaterSorterInstalled) return;
  globalThis.__watchLaterSorterInstalled = true;
  const { isSortMode, formatPublished } = globalThis.WatchLaterSort;
  const dateOverlay = globalThis.WatchLaterDateOverlay;
  const CHANNEL = 'wl-sorter-bilibili-v1';
  const OPTIONS = [
    ['published-desc', '最新发布', '按发布时间从新到旧排序'],
    ['published-asc', '最早发布', '按发布时间从旧到新排序'],
    ['duration-desc', '时长最长', '按视频时长从长到短排序'],
    ['duration-asc', '时长最短', '按视频时长从短到长排序']
  ];
  const NATIVE = new Set(['最近添加', '最早添加']);
  const optionElements = new Map();
  let mode = null;
  let cached = null;
  let dataPromise = null;
  let cacheEpoch = 0;
  let nativeGrid = null;
  let preparedGrid = null;
  let scheduled = false;
  let revision = 0;
  let activeDates = null;
  let triggerLabel = null;
  let lastNativeCaption = '最近添加';
  let errorMessage = '';

  function captionOf(element) {
    return element?.textContent?.replace(/[\s▼▽⌄▾∨]/g, '').trim() || '';
  }
  function isVisible(element) {
    const rect = element?.getBoundingClientRect?.();
    return !!rect && rect.width > 0 && rect.height > 0;
  }
  function isListPage() {
    return /^\/(?:watchlater(?:\/list)?|list\/watchlater)\/?$/.test(location.pathname) &&
      (!location.hash || /^#\/list(?:[/?#]|$)/.test(location.hash));
  }
  // Find two *menu options* sharing one parent, never the dropdown trigger.
  function findNativeMenu() {
    const candidates = [];
    const seen = new Set();
    for (const element of document.querySelectorAll('li, button, [role="option"], [role="menuitem"], span, div')) {
      if (element.closest('[data-wl-sorter-option]')) continue;
      const caption = captionOf(element);
      if (!NATIVE.has(caption) || !isVisible(element)) continue;
      let row = element;
      while (row.parentElement && row.parentElement !== document.body &&
             captionOf(row.parentElement) === caption &&
             row.parentElement.getBoundingClientRect().width < 320) {
        row = row.parentElement;
      }
      if (row.parentElement && !seen.has(row)) {
        seen.add(row);
        candidates.push({ row, caption });
      }
    }
    let best = null;
    for (const recent of candidates.filter(item => item.caption === '最近添加')) {
      for (const oldest of candidates.filter(item => item.caption === '最早添加')) {
        if (recent.row === oldest.row || recent.row.parentElement !== oldest.row.parentElement)
          continue;
        const menu = recent.row.parentElement;
        if (menu.contains(nativeGrid)) continue;
        const labels = [...menu.children].filter(child => NATIVE.has(captionOf(child)));
        if (labels.length < 2) continue;
        // Prefer real dropdown/listbox structures if both menu items and
        // the current selected-value label are present elsewhere on the page.
        const names = String(menu.className || '') + ' ' +
          String(menu.parentElement?.className || '');
        const score = (/dropdown|popper|select|menu|sort/i.test(names) ? 10 : 0) +
          (['LI'].includes(recent.row.tagName) ? 4 : 0) +
          (menu.matches?.('[role="listbox"],[role="menu"]') ? 4 : 0);
        if (!best || score > best.score)
          best = { menu, recent: recent.row, oldest: oldest.row, score };
      }
    }
    return best;
  }
  function findTriggerLabel(menu) {
    if (triggerLabel?.isConnected && !menu.contains(triggerLabel))
      return triggerLabel;
    if (!nativeGrid) return null;
    const gridTop = nativeGrid.getBoundingClientRect().top;
    const possible = [...document.querySelectorAll('span, button, div')]
      .filter(node => !menu.contains(node) &&
        NATIVE.has(captionOf(node)) && isVisible(node) &&
        node.getBoundingClientRect().top <= gridTop + 30 &&
        gridTop - node.getBoundingClientRect().top < 250);
    const leaf = possible.filter(node => ![...node.children].some(child => captionOf(child) === captionOf(node)));
    leaf.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
    triggerLabel = leaf[0] || null;
    if (triggerLabel) lastNativeCaption = captionOf(triggerLabel);
    return triggerLabel;
  }
  function syncTrigger(menu) {
    const label = findTriggerLabel(menu);
    if (!label) return;
    const value = OPTIONS.find(option => option[0] === mode)?.[1];
    if (value && captionOf(label) !== value) label.textContent = value;
  }
  function clearInjectedOptions() {
    for (const option of optionElements.values()) option.remove();
    optionElements.clear();
    triggerLabel = null;
  }
  function cloneMenuOption(nativeOption, value, caption, title) {
    const option = nativeOption.cloneNode(true);
    const nodes = [option, ...option.querySelectorAll('*')];
    const previous = captionOf(nativeOption);
    const labelNode = nodes.filter(node => captionOf(node) === previous).at(-1) || option;
    labelNode.textContent = caption;
    for (const node of nodes) {
      node.removeAttribute('id');
      node.removeAttribute('href');
      node.removeAttribute('aria-selected');
      node.removeAttribute('aria-checked');
      node.removeAttribute('aria-disabled');
      node.removeAttribute('disabled');
      node.removeAttribute('data-wl-sorter-native-option');
      node.classList?.remove('active', 'selected', 'is-active', 'on', 'checked');
      for (const attr of [...node.attributes])
        if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
    }
    option.dataset.wlSorterOption = value;
    option.title = title;
    option.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation(); // Do not call Bilibili's native sort handler.
      void choose(value);
      // Let the native dropdown's outside-click handler close the menu.
      document.documentElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.documentElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    return option;
  }
  function report(message = '') {
    errorMessage = message;
    for (const [value, option] of optionElements) {
      const title = OPTIONS.find(item => item[0] === value)?.[2];
      option.title = message || title;
    }
    if (message) console.error('[稍后再看排序] ' + message);
  }
  function mount() {
    const grid = isListPage() ? document.querySelector('.watchlater-list-container') : null;
    if (grid !== nativeGrid) {
      dateOverlay.clear(nativeGrid);
      clearInjectedOptions();
      activeDates = null;
      revision++;
      mode = null;
      nativeGrid = grid;
      preparedGrid = null;
    }
    if (!grid) return false;
    const found = findNativeMenu();
    if (found) {
      const { menu, recent, oldest } = found;
      if (recent.dataset.wlSorterNativeOption !== '最近添加')
        recent.dataset.wlSorterNativeOption = '最近添加';
      if (oldest.dataset.wlSorterNativeOption !== '最早添加')
        oldest.dataset.wlSorterNativeOption = '最早添加';
      findTriggerLabel(menu);
      let after = oldest;
      for (const [value, caption, title] of OPTIONS) {
        let option = optionElements.get(value);
        if (!option || option.parentElement !== menu) {
          option?.remove();
          option = cloneMenuOption(oldest, value, caption, title);
          optionElements.set(value, option);
        }
        if (after.nextSibling !== option) menu.insertBefore(option, after.nextSibling);
        after = option;
      }
      syncTrigger(menu);
      if (errorMessage) report(errorMessage);
    }
    return true;
  }
  // Native options keep their original Vue event handlers and functionality.
  function returnToNative(event) {
    const row = event.target?.closest?.('[data-wl-sorter-native-option]');
    if (!row || !nativeGrid) return;
    revision++;
    mode = null;
    activeDates = null;
    lastNativeCaption = row.dataset.wlSorterNativeOption;
    if (triggerLabel?.isConnected) triggerLabel.textContent = lastNativeCaption;
    dateOverlay.clear(nativeGrid);
    report('');
  }
  document.addEventListener('click', returnToNative, true);
  // Mark options before click even when Bilibili mounts a popup on hover
  // or just before pointerdown, with no existing menu DOM at page load.
  document.addEventListener('pointerdown', () => {
    if (isListPage()) mount();
  }, true);
  document.addEventListener('mouseover', event => {
    if (NATIVE.has(captionOf(event.target))) schedule();
  }, true);

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
    if (!OPTIONS.some(option => option[0] === next) || !isSortMode(next)) return;
    const current = ++revision;
    mode = next;
    if (nativeGrid) {
      const found = findNativeMenu();
      if (found) syncTrigger(found.menu);
    }
    activeDates = null;
    dateOverlay.clear(nativeGrid);
    report('');
    // No persistent preference: a refresh retains Bilibili's native order.
    try {
      if (!mount()) throw new Error('未找到 B站稍后再看原生列表');
      beginPreload();
      // Use the document_start snapshot first; avoid a duplicate network round-trip.
      // The MAIN-world sorter verifies exact native identities before reordering.
      let items = await fullData();
      if (current !== revision) return;
      let result = await requestPage('SET_MODE', { mode: next, items }, 120000);
      if (current !== revision) return;
      if (!result?.ok && result?.staleMetadata === true) {
        // Additions/deletions can invalidate the earlier snapshot. Fetch once
        // again only when the native store proves that it is out of date.
        items = await fullData(true);
        if (current !== revision) return;
        result = await requestPage('SET_MODE', { mode: next, items }, 120000);
        if (current !== revision) return;
      }
      if (!result?.ok)
        throw new Error(result?.error || '原生列表排序超时或页面脚本未响应');
      if (next === 'published-asc' || next === 'published-desc') {
        activeDates = dateOverlay.dateMap(items, formatPublished);
        showPublicationDates();
      }
      // Keep Bilibili's own select and menu styling unchanged.
    } catch (reason) {
      if (current !== revision) return;
      cacheEpoch++;
      cached = null;
      mode = null;
      if (triggerLabel?.isConnected) triggerLabel.textContent = lastNativeCaption;
      report('全量排序失败：' + (reason?.message || reason));
    } finally {
      if (current === revision) schedule();
    }
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'WL_SORTER_OPEN') {
      const first = optionElements.values().next().value;
      (first || triggerLabel)?.focus?.();
    }
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
    if (records.some(record => {
      if (record.type === 'attributes')
        return !record.target.closest?.('[data-wl-sorter-option]') &&
          record.attributeName !== 'data-wl-sorter-native-option';
      return [...record.addedNodes, ...record.removedNodes].some(node =>
        node.nodeType === 1 && !node.hasAttribute?.('data-wl-sorter-option'));
    })) schedule();
  }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['class', 'style', 'data-wl-sorter-native-option']
  });
  schedule();
})();
