/* MAIN-world bridge: prepare Bilibili's full Pinia list on page open,
 * then sort existing native records only after the user selects a mode.
 */
(() => {
  'use strict';
  const CHANNEL = 'wl-sorter-bilibili-v1';
  const MODES = globalThis.WatchLaterSort;
  const FULL = globalThis.WatchLaterFullNative;
  let queue = Promise.resolve();

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const request = event.data;
    if (request?.channel !== CHANNEL ||
        !['PREPARE', 'SET_MODE'].includes(request.type) ||
        typeof request.id !== 'string' || !/^[a-f0-9-]{16,64}$/i.test(request.id) ||
        (request.type === 'SET_MODE' && !MODES.isSortMode(request.mode))) return;

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
          result = await FULL.sortFull(store, request.items, request.mode, MODES.sortVideos);
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
