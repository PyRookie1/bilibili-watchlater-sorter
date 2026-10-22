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
  // The content script marks the actual dropdown entries. Never treat the
  // current-value trigger as a native option when the menu is merely opened.
  window.addEventListener('click', event => {
    const option = event.target?.closest?.('[data-wl-sorter-native-option]');
    const caption = option?.getAttribute('data-wl-sorter-native-option');
    if (caption !== '最近添加' && caption !== '最早添加') return;
    nativeEpoch++;
    if (!customActive) return;
    customActive = false;
    const store = FULL.findStore(document.querySelector('.watchlater-list-container'));
    if (!store || !lastCustomItems) return;
    try {
      FULL.restoreNativeOrder(store, lastCustomItems, caption, MODES.sortVideos);
    } catch {
      // Native Bilibili handlers still process this click without interference.
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
        result = {
          ok: false,
          error: String(error?.message || error),
          staleMetadata: error?.code === 'WL_SORTER_STALE_METADATA'
        };
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
