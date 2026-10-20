/* Runs in Bilibili page world before its application requests the watch-later list.
 * Reorders complete API response data; never scrolls or replaces native cards.
 */
(function (root) {
  'use strict';
  const STORE = 'wl-sorter-mode';
  const CHANNEL = 'wl-sorter-bilibili-v1';
  const SORT = root.WatchLaterSort;
  let mode = 'default';
  try {
    const saved = localStorage.getItem(STORE);
    if (SORT.isSortMode(saved)) mode = saved;
  } catch {}
  let lastUnsorted = null;

  function isListRequest(url) {
    try {
      const u = new URL(String(url), location.href);
      return u.origin === 'https://api.bilibili.com' &&
        /^\/x\/v2\/history\/toview(?:\/web)?\/?$/.test(u.pathname);
    } catch { return false; }
  }
  function completeData(body) {
    return body?.code === 0 && Number.isSafeInteger(body.data?.count) &&
      body.data.count >= 0 && Array.isArray(body.data?.list) &&
      body.data.list.length === body.data.count;
  }
  function transform(body, selected = mode) {
    if (!completeData(body)) return body;
    lastUnsorted = body.data.list.slice();
    if (selected === 'default' || !SORT.isSortMode(selected)) return body;
    return { ...body, data: { ...body.data,
      list: SORT.sortVideos(body.data.list, selected) } };
  }
  function itemId(item) {
    const source = item?.archive || item?.video || item?.info || item;
    if (typeof source?.bvid === 'string' && /^BV[0-9a-zA-Z]{10}$/.test(source.bvid))
      return 'bv:' + source.bvid;
    if (Number.isSafeInteger(source?.aid) && source.aid > 0) return 'av:' + source.aid;
    return null;
  }
  function rearrangeNativeState(grid = document.querySelector('.watchlater-list-container')) {
    if (!grid || !lastUnsorted?.length) return false;
    const ordered = SORT.sortVideos(lastUnsorted, mode);
    const rank = new Map();
    ordered.forEach((video, i) => {
      const id = itemId(video);
      if (id) rank.set(id, i);
      if (Number.isSafeInteger(video?.aid)) rank.set('av:' + video.aid, i);
    });
    const candidates = [];
    const visited = new Set();
    let element = grid;
    for (let depth = 0; element && depth < 10; depth++, element = element.parentElement) {
      const vue3 = element.__vueParentComponent;
      for (let instance = vue3, i = 0; instance && i < 12; instance = instance.parent, i++)
        candidates.push(instance.setupState, instance.data, instance.ctx, instance.proxy);
      const vue2 = element.__vue__;
      for (let instance = vue2, i = 0; instance && i < 12; instance = instance.$parent, i++)
        candidates.push(instance.$data, instance);
    }
    function inspect(value, depth) {
      if (!value || typeof value !== 'object' || visited.has(value) || visited.size > 1200) return false;
      visited.add(value);
      if (Array.isArray(value)) {
        if (value.length !== lastUnsorted.length || value.length === 0) return false;
        const original = Array.from(value);
        if (!original.every(x => typeof x === 'object' && x !== null)) return false;
        const positions = original.map(x => rank.get(itemId(x)));
        if (positions.some(x => x === undefined) || new Set(positions).size !== original.length) return false;
        const reordered = original.map((value, i) => ({ value, order: positions[i] }))
          .sort((a, b) => a.order - b.order).map(x => x.value);
        if (reordered.every((value, i) => value === original[i])) return true;
        try { value.splice(0, value.length, ...reordered); return true; } catch { return false; }
      }
      if (depth >= 3) return false;
      let keys;
      try { keys = Object.keys(value).slice(0, 120); } catch { return false; }
      for (const key of keys) {
        if (key.startsWith('_') || key.startsWith('$')) continue;
        try { if (inspect(value[key], depth + 1)) return true; } catch {}
      }
      if ('value' in value) {
        try { if (inspect(value.value, depth + 1)) return true; } catch {}
      }
      return false;
    }
    return candidates.some(candidate => inspect(candidate, 0));
  }

  if (typeof root.fetch === 'function') {
    const originalFetch = root.fetch;
    root.fetch = async function (...args) {
      const response = await Reflect.apply(originalFetch, this, args);
      const target = args[0] instanceof Request ? args[0].url : args[0];
      if (!isListRequest(target) || !response.ok) return response;
      try {
        const original = await response.clone().json();
        if (!completeData(original)) return response;
        const result = transform(original);
        if (result === original) return response;
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        headers.delete('content-encoding');
        return new Response(JSON.stringify(result), {
          status: response.status, statusText: response.statusText, headers
        });
      } catch { return response; }
    };
  }

  if (typeof root.XMLHttpRequest === 'function') {
    const proto = root.XMLHttpRequest.prototype;
    const baseOpen = proto.open;
    const responseTextDescriptor = Object.getOwnPropertyDescriptor(proto, 'responseText');
    const responseDescriptor = Object.getOwnPropertyDescriptor(proto, 'response');
    proto.open = function (method, url, ...args) {
      const intercept = String(method).toUpperCase() === 'GET' && isListRequest(url);
      if (intercept && responseTextDescriptor?.get && responseDescriptor?.get) {
        const current = this;
        let readyCache = null;
        function getTransformed() {
          if (current.readyState !== 4 || current.status < 200 || current.status >= 300) return null;
          if (readyCache) return readyCache;
          try {
            const kind = current.responseType;
            const raw = kind === 'json' ? responseDescriptor.get.call(current) :
              JSON.parse(responseTextDescriptor.get.call(current));
            if (!completeData(raw)) return null;
            const patched = transform(raw);
            readyCache = { object: patched, text: JSON.stringify(patched) };
            return readyCache;
          } catch { return null; }
        }
        try {
          Object.defineProperty(this, 'responseText', {
            configurable: true, get() {
              const data = getTransformed();
              return data && (!current.responseType || current.responseType === 'text') ?
                data.text : responseTextDescriptor.get.call(current);
            }
          });
          Object.defineProperty(this, 'response', {
            configurable: true, get() {
              const data = getTransformed();
              if (!data) return responseDescriptor.get.call(current);
              return current.responseType === 'json' ? data.object :
                !current.responseType || current.responseType === 'text' ?
                  data.text : responseDescriptor.get.call(current);
            }
          });
        } catch {}
      }
      return Reflect.apply(baseOpen, this, [method, url, ...args]);
    };
  }

  root.addEventListener('message', event => {
    if (event.source !== root || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.channel !== CHANNEL || data.type !== 'SET_MODE' || !SORT.isSortMode(data.mode)) return;
    mode = data.mode;
    try { localStorage.setItem(STORE, mode); } catch {}
    const applied = rearrangeNativeState();
    root.postMessage({ channel: CHANNEL, type: 'MODE_RESULT', id: data.id, applied }, location.origin);
  });

  root.WatchLaterNativeBridge = Object.freeze({
    transform, completeData, isListRequest, rearrangeNativeState
  });
})(globalThis);
