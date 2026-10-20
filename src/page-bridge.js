/* Page-context fallback: use the existing Bilibili login; never read cookies. */
(() => {
  'use strict';
  const CHANNEL = 'wl-sorter-bilibili-v1';
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.channel !== CHANNEL || data.type !== 'REQUEST' ||
        typeof data.id !== 'string' || !/^[a-f0-9-]{16,64}$/.test(data.id)) return;
    let payload;
    try {
      const expectedCount = Number.isSafeInteger(data.expectedCount) && data.expectedCount >= 0
        ? data.expectedCount : undefined;
      payload = await globalThis.WatchLaterApi.fetchCompleteList(fetch, { expectedCount });
    } catch (error) {
      payload = { ok: false, error: error instanceof Error ? error.message : '无法读取完整列表' };
    }
    window.postMessage({ channel: CHANNEL, type: 'RESPONSE', id: data.id, payload }, location.origin);
  });
})();
