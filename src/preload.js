/* Begin fetching complete sort metadata as early as the page opens.
 * The result is shared with the document_idle UI script in this isolated world.
 * The background adapter validates count === list.length.
 */
(() => {
  'use strict';
  const path = location.pathname;
  if (!/^\/(?:watchlater(?:\/list)?|list\/watchlater)\/?$/.test(path)) return;
  if (location.hash && !/^#\/list(?:[/?#]|$)/.test(location.hash)) return;
  globalThis.WatchLaterEarlyDataPromise =
    chrome.runtime.sendMessage({ type: 'WL_SORTER_FETCH' }).catch(() => null);
})();
