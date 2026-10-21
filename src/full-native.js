/* Full native Pinia list sorting. Does not fabricate Bilibili card data or scroll. */
(function (root) {
  'use strict';
  const MAX_ITEMS = 10000;
  const ID_RE = /^BV[0-9a-zA-Z]{10}$/;

  function identity(video) {
    if (!video || typeof video !== 'object') return null;
    for (const item of [video, video.video, video.archive, video.video_info, video.info]) {
      if (typeof item?.bvid === 'string' && ID_RE.test(item.bvid)) return 'bv:' + item.bvid;
      if (Number.isSafeInteger(item?.aid) && item.aid > 0) return 'av:' + item.aid;
    }
    return null;
  }

  function findStore(grid) {
    if (!grid) return null;
    for (let node = grid; node; node = node.parentElement) {
      const providers = node.__vue_app__?._context?.provides;
      if (!providers) continue;
      for (const key of Reflect.ownKeys(providers)) {
        const pinia = providers[key];
        if (pinia?._s instanceof Map && pinia._s.has('list')) {
          const store = pinia._s.get('list');
          if (Array.isArray(store?.watchlaterList) && typeof store?.loadMoreWatchlaterList === 'function')
            return store;
        }
      }
    }
    return null;
  }

  function assertMetadata(items) {
    if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS)
      throw new Error('完整视频列表不存在');
    const ids = items.map(identity);
    if (ids.some(id => !id) || new Set(ids).size !== ids.length)
      throw new Error('接口视频身份信息缺失或重复，无法安全全量排序');
    return ids;
  }

  function getNativeItems(store) {
    return store?.watchlaterList;
  }

  async function awaitIdle(store, ms = 9000) {
    const deadline = Date.now() + ms;
    while (store.loading) {
      if (Date.now() > deadline) throw new Error('B站列表加载超时');
      await new Promise(resolve => setTimeout(resolve, 75));
    }
  }

  async function materialize(store, count) {
    if (!Array.isArray(getNativeItems(store))) throw new Error('原生稍后再看列表不存在');
    if (Number.isSafeInteger(store.totalCount) && store.totalCount !== count) {
      throw new Error('当前筛选列表数量与全部视频数不同，请先恢复全部列表');
    }
    const maxCalls = Math.min(100, Math.ceil(Math.max(0, count - getNativeItems(store).length) / 20) + 8);
    let stalled = 0;
    for (let call = 0; getNativeItems(store).length < count && call < maxCalls; call++) {
      await awaitIdle(store);
      const before = getNativeItems(store).length;
      if (before >= count) break;
      let timer;
      try {
        await Promise.race([
          Promise.resolve().then(() => store.loadMoreWatchlaterList()),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('B站原生列表加载超时')), 12000);
          })
        ]);
      } finally {
        clearTimeout(timer);
      }
      await awaitIdle(store);
      const after = getNativeItems(store).length;
      if (after > count) throw new Error('原生列表数量超过接口数据，停止排序');
      stalled = after > before ? 0 : stalled + 1;
      if (stalled >= 2) break;
    }
    const size = getNativeItems(store).length;
    if (size !== count)
      throw new Error('原生列表只加载到 ' + size + '/' + count + '，未执行局部排序');
  }

  function applyOrder(store, raw, mode, sortVideos) {
    const ids = assertMetadata(raw);
    const records = getNativeItems(store);
    if (!Array.isArray(records) || records.length !== ids.length)
      throw new Error('原生视频条目尚未完整加载');
    const recordIds = records.map(identity);
    const indexById = new Map();
    recordIds.forEach((id, index) => {
      if (id === null || indexById.has(id))
        throw new Error('原生视频身份信息不完整或重复');
      indexById.set(id, index);
    });
    const sortedRaw = mode === 'default' ? raw.slice() : sortVideos(raw, mode);
    const newIndices = sortedRaw.map(item => indexById.get(identity(item)));
    if (newIndices.some(index => index === undefined) ||
        new Set(newIndices).size !== raw.length)
      throw new Error('原生视频与接口完整列表无法一一匹配');
    const next = newIndices.map(index => records[index]);
    const checked = store.checkedList;
    const alignChecked = Array.isArray(checked) && checked.length === records.length;
    const nextChecked = alignChecked ? newIndices.map(index => checked[index]) : null;
    // Do not replace card objects or the reactive array identity. Native actions
    // continue to refer to the same records; checkbox state follows its item.
    if (typeof store.$patch === 'function') {
      store.$patch(state => {
        state.watchlaterList.splice(0, state.watchlaterList.length, ...next);
        if (nextChecked && Array.isArray(state.checkedList))
          state.checkedList.splice(0, state.checkedList.length, ...nextChecked);
      });
    } else {
      records.splice(0, records.length, ...next);
      if (nextChecked) checked.splice(0, checked.length, ...nextChecked);
    }
    return next.length;
  }

  async function sortFull(store, raw, mode, sortVideos) {
    assertMetadata(raw);
    await materialize(store, raw.length);
    const count = applyOrder(store, raw, mode, sortVideos);
    return { ok: true, count };
  }

  root.WatchLaterFullNative = Object.freeze({
    identity, findStore, assertMetadata, materialize, applyOrder, sortFull
  });
  if (typeof module !== 'undefined' && module.exports)
    module.exports = root.WatchLaterFullNative;
})(typeof globalThis !== 'undefined' ? globalThis : this);
