/* MAIN-world bridge: prepare Bilibili's full Pinia list on page open,
 * then sort existing native records only after the user selects a mode.
 */
(() => {
  'use strict';
  const CHANNEL = 'wl-sorter-bilibili-v1';
  const MODES = globalThis.WatchLaterSort;
  const FULL = globalThis.WatchLaterFullNative;
  let queue = Promise.resolve();
  let nativeEpoch = 0;
  let lastCustomItems = null;
  let customActive = false;
  const nativeCaptions = new Set(['最近添加', '最早添加']);

  function nativeCaption(target) {
    for (let node = target; node && node !== document.documentElement; node = node.parentElement) {
      if (node.closest?.('#wl-sorter-root')) return null;
      const caption = node.textContent?.replace(/[\s▼▽⌄▾∨]/g, '').trim() || '';
      if (nativeCaptions.has(caption)) return caption;
      if (caption.length > 25) break;
    }
    return null;
  }
  // Capture before Vue's native click handler, including a click on
  // the already-selected native option.
  window.addEventListener('click', event => {
    const caption = nativeCaption(event.target);
    if (!caption) return;
    nativeEpoch++;
    if (!customActive) return;
    customActive = false;
    const store = FULL.findStore(document.querySelector('.watchlater-list-container'));
    if (!store || !lastCustomItems) return;
    try {
      FULL.restoreNativeOrder(store, lastCustomItems, caption, MODES.sortVideos);
    } catch {
      // Keep Bilibili's original click handler responsible for changed lists.
    }
  }, true);

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const request = event.data;
    if (request?.channel !== CHANNEL ||
        !['PREPARE', 'SET_MODE'].includes(request.type) ||
        typeof request.id !== 'string' || !/^[a-f0-9-]{16,64}$/i.test(request.id) ||
        (request.type === 'SET_MODE' && !MODES.isSortMode(request.mode))) return;

    const requestedEpoch = nativeEpoch;
    queue = queue.catch(() => {}).then(async () => {
      let result;
      try {
        const store = FULL.findStore(document.querySelector('.watchlater-list-container'));
        if (!store) throw new Error('未找到 B站原生 Pinia list store');
        if (request.type === 'PREPARE') {
          // Only load the native cards; their order stays Bilibili default.
          result = await FULL.prepare(store);
        } else {
          FULL.assertMetadata(request.items);
          if (requestedEpoch !== nativeEpoch) throw new Error('已切换至 B站原生排序');
          result = await FULL.sortFull(store, request.items, request.mode, MODES.sortVideos,
            () => requestedEpoch === nativeEpoch);
          if (requestedEpoch === nativeEpoch) {
            lastCustomItems = request.items;
            customActive = true;
          }
        }
      } catch (error) {
        result = { ok: false, error: String(error?.message || error) };
      }
      window.postMessage({
        channel: CHANNEL,
        type: request.type === 'PREPARE' ? 'PREPARE_RESULT' : 'MODE_RESULT',
        id: request.id,
        ...result
      }, location.origin);
    });
  });
})();
