/* MAIN-world bridge: sort Bilibili's complete native Pinia list.
 * Use the website's loadMoreWatchlaterList action, never scroll or fake cards.
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
    if (request?.channel !== CHANNEL || request.type !== 'SET_MODE' ||
        typeof request.id !== 'string' || !/^[a-f0-9-]{16,64}$/i.test(request.id) ||
        !MODES.isSortMode(request.mode)) return;
    const raw = request.items;
    queue = queue.catch(() => {}).then(async () => {
      let result;
      try {
        FULL.assertMetadata(raw);
        const store = FULL.findStore(document.querySelector('.watchlater-list-container'));
        if (!store) throw new Error('未找到 B站原生 Pinia list store');
        result = await FULL.sortFull(store, raw, request.mode, MODES.sortVideos);
      } catch (error) {
        result = { ok: false, error: String(error?.message || error) };
      }
      window.postMessage({
        channel: CHANNEL, type: 'MODE_RESULT', id: request.id, ...result
      }, location.origin);
    });
  });
})();
