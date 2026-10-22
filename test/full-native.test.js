const test = require('node:test');
const assert = require('node:assert/strict');
const native = require('../src/full-native.js');
const { sortVideos } = require('../src/sort.js');

function rawVideos(count = 424) {
  return Array.from({ length: count }, (_, i) => ({
    aid: i + 1, bvid: 'BV' + String(i + 1).padStart(10, '0'),
    pubdate: 10000 + i, duration: 90000 - i
  }));
}
function card(video) {
  return {
    aid: video.aid, cid: video.aid * 10, bvid: video.bvid,
    cover: 'native cover', rawTitle: 'native title ' + video.aid,
    title: { title: 'native title', text: 'native text' },
    author: { name: 'native author' }, stats: { view: 100 + video.aid },
    progress: 0, isFinished: false
  };
}
function storeFor(raw, initial = 20) {
  const allCards = raw.map(card);
  const checkByAid = new Map(allCards.map(video => [video.aid, { aid: video.aid, checked: video.aid === 6 }]));
  const state = {
    totalCount: raw.length, loading: false,
    watchlaterList: allCards.slice(0, initial),
    checkedList: allCards.slice(0, initial).map(video => checkByAid.get(video.aid))
  };
  let loads = 0;
  const store = {
    get watchlaterList() { return state.watchlaterList; },
    get checkedList() { return state.checkedList; },
    get totalCount() { return state.totalCount; },
    get loading() { return state.loading; },
    $patch(callback) { callback(state); },
    async loadMoreWatchlaterList() {
      loads++;
      const from = state.watchlaterList.length;
      const next = allCards.slice(from, from + 20);
      state.watchlaterList.push(...next);
      state.checkedList.push(...next.map(video => checkByAid.get(video.aid)));
    }
  };
  return { store, state, allCards, get loads() { return loads; } };
}

test('experimental C builds missing cards in one transaction when schema is recognized', async () => {
  const raw = rawVideos(80).map((video, i) => ({
    ...video, cid: 10000 + i, title: 'Video ' + i,
    pic: 'https://i0.hdslb.com/cover.jpg',
    owner: 'Uploader ' + i, ownerMid: i + 20, viewCount: i * 5
  }));
  const mock = storeFor(raw);
  const result = await native.sortFull(mock.store, raw, 'published-desc', sortVideos);
  assert.deepEqual(result, { ok: true, count: 80 });
  assert.equal(mock.loads, 0);
  assert.equal(mock.state.watchlaterList[0].aid, 80);
  assert.equal(mock.state.watchlaterList[0].cid, raw[79].cid);
  assert.equal(mock.state.watchlaterList[0].title.text, raw[79].title);
  assert.equal(mock.state.checkedList.length, 80);
});

test('finds Bilibili list store in Vue app-level Pinia injection', () => {
  const mock = storeFor(rawVideos());
  const root = { __vue_app__: { _context: { provides: {
    [Symbol('pinia')]: { _s: new Map([['list', mock.store]]) }
  } } }, parentElement: null };
  const grid = { parentElement: root };
  assert.equal(native.findStore(grid), mock.store);
});

test('loads all 424 native records in 21 calls without scrolling, then fully sorts', async () => {
  const raw = rawVideos();
  const mock = storeFor(raw);
  const originalFirst = mock.state.watchlaterList[0];
  const result = await native.sortFull(mock.store, raw, 'duration-asc', sortVideos);
  assert.deepEqual(result, { ok: true, count: 424 });
  assert.equal(mock.loads, 21);
  assert.equal(mock.state.watchlaterList.length, 424);
  assert.equal(mock.state.watchlaterList[0], mock.allCards[423], 'must keep original normalized native object');
  assert.equal(mock.state.watchlaterList[423], originalFirst);
  assert.equal(mock.state.watchlaterList[0].title.text, 'native text');
  assert.equal(mock.state.watchlaterList[0].stats.view, 524);
  assert.equal(mock.state.checkedList[418].aid, 6, 'selection stays on its original video');
  assert.equal(mock.state.checkedList[418].checked, true);
});

test('switching modes reorders all 424 records, including restoring native API order', async () => {
  const raw = rawVideos();
  const mock = storeFor(raw, 424);
  await native.sortFull(mock.store, raw, 'published-desc', sortVideos);
  assert.equal(mock.state.watchlaterList[0].aid, 424);
  await native.sortFull(mock.store, raw, 'default', sortVideos);
  assert.equal(mock.state.watchlaterList[0].aid, 1);
  assert.equal(mock.state.watchlaterList[423].aid, 424);
});

test('rejects incomplete pagination instead of sorting 20 existing cards', async () => {
  const raw = rawVideos();
  const mock = storeFor(raw);
  mock.store.loadMoreWatchlaterList = async () => {};
  await assert.rejects(
    native.sortFull(mock.store, raw, 'duration-asc', sortVideos),
    /原生列表只加载到 20\/424/
  );
  assert.equal(mock.state.watchlaterList.length, 20);
  assert.equal(mock.state.watchlaterList[0].aid, 1);
});

test('rejects filtered lists and raw/native identity mismatches safely', async () => {
  const raw = rawVideos();
  const mock = storeFor(raw, 424);
  mock.state.totalCount = 20;
  mock.state.watchlaterList = mock.state.watchlaterList.slice(0, 20);
  mock.state.checkedList = mock.state.checkedList.slice(0, 20);
  await assert.rejects(native.sortFull(mock.store, raw, 'published-desc', sortVideos), /筛选/);
  mock.state.totalCount = 424;
  mock.state.watchlaterList = mock.allCards.slice();
  mock.state.checkedList = mock.allCards.map(x => ({ aid: x.aid }));
  mock.state.watchlaterList[3].bvid = 'BV0000009999';
  await assert.rejects(native.sortFull(mock.store, raw, 'published-desc', sortVideos), /无法一一匹配/);
  assert.equal(mock.state.watchlaterList[0].aid, 1);
});

test('handles native state where loading replaces the reactive array instance', async () => {
  const raw = rawVideos(60);
  const mock = storeFor(raw);
  mock.store.loadMoreWatchlaterList = async () => {
    const begin = mock.store.watchlaterList.length;
    mock.state.watchlaterList = [...mock.state.watchlaterList, ...mock.allCards.slice(begin, begin + 20)];
    mock.state.checkedList = [...mock.state.checkedList, ...mock.allCards.slice(begin, begin + 20).map(video => ({ aid: video.aid }))];
  };
  const result = await native.sortFull(mock.store, raw, 'duration-asc', sortVideos);
  assert.equal(result.count, 60);
  assert.equal(mock.state.watchlaterList[0].aid, 60);
  assert.equal(mock.state.watchlaterList.length, 60);
});


test('page-open PREPARE hydrates all native cards but leaves Bilibili default order intact', async () => {
  const raw = rawVideos();
  const mock = storeFor(raw);
  const first = mock.state.watchlaterList[0];
  const result = await native.prepare(mock.store);
  assert.deepEqual(result, { ok: true, count: 424 });
  assert.equal(mock.state.watchlaterList.length, 424);
  assert.equal(mock.state.watchlaterList[0], first);
  assert.deepEqual(mock.state.watchlaterList.map(x => x.aid), raw.map(x => x.aid));
  assert.equal(mock.loads, 21);
  await native.sortFull(mock.store, raw, 'duration-asc', sortVideos);
  assert.equal(mock.loads, 21, 'select after warmup must not repeat network loads');
  assert.equal(mock.state.watchlaterList[0].aid, 424);
});

test('PREPARE waits for delayed initial native Pinia state without touching order', async () => {
  const raw = rawVideos(60);
  const mock = storeFor(raw, 0);
  mock.state.totalCount = 0;
  mock.state.inited = false;
  Object.defineProperty(mock.store, 'inited', { get: () => mock.state.inited });
  const operation = native.prepare(mock.store);
  setTimeout(() => {
    mock.state.totalCount = 60;
    mock.state.inited = true;
    mock.state.watchlaterList.push(...mock.allCards.slice(0, 20));
    mock.state.checkedList.push(...mock.allCards.slice(0, 20).map(x => ({ aid: x.aid })));
  }, 35);
  const result = await operation;
  assert.equal(result.count, 60);
  assert.equal(mock.state.watchlaterList.length, 60);
  assert.equal(mock.state.watchlaterList[0].aid, 1);
  assert.equal(mock.loads, 2);
});

test('sort after deleting videos uses the updated native identities', async () => {
  const raw = rawVideos(60);
  const mock = storeFor(raw, 60);
  await native.sortFull(mock.store, raw, 'duration-asc', sortVideos);
  const deleted = new Set([3, 15, 26, 48, 60]);
  const records = mock.state.watchlaterList;
  const checked = mock.state.checkedList;
  for (let i = records.length - 1; i >= 0; i--) {
    if (deleted.has(records[i].aid)) {
      records.splice(i, 1);
      checked.splice(i, 1);
    }
  }
  // The count can still be stale while Bilibili updates its reactive list.
  assert.equal(mock.store.totalCount, 60);
  const remaining = raw.filter(v => !deleted.has(v.aid));
  const previousLoads = mock.loads;
  const result = await native.sortFull(mock.store, remaining, 'published-desc', sortVideos);
  assert.deepEqual(result, { ok: true, count: 55 });
  assert.equal(mock.loads, previousLoads, 'do not attempt to reload deleted videos');
  assert.deepEqual(records.map(v => v.aid), remaining.map(v => v.aid).reverse());
  assert.deepEqual(checked.map(v => v.aid), records.map(v => v.aid));
});

test('sort after deleting all videos supports an empty list', async () => {
  const raw = rawVideos(20);
  const mock = storeFor(raw, 20);
  mock.state.watchlaterList.splice(0);
  mock.state.checkedList.splice(0);
  const result = await native.sortFull(mock.store, [], 'duration-asc', sortVideos);
  assert.deepEqual(result, { ok: true, count: 0 });
  assert.equal(mock.loads, 0);
});

test('unchanged count cannot mask a deleted-and-added video', async () => {
  const raw = rawVideos(20);
  const mock = storeFor(raw, 20);
  const current = raw.slice(1).concat({ aid: 21, bvid: 'BV0000000021', pubdate: 55, duration: 42 });
  await assert.rejects(native.sortFull(mock.store, current, 'duration-asc', sortVideos), /无法一一匹配/);
  assert.deepEqual(mock.state.watchlaterList.map(v => v.aid), raw.map(v => v.aid));
});

test('matching identities are enough when native totalCount is stale', async () => {
  const raw = rawVideos(20);
  const mock = storeFor(raw, 20);
  mock.state.totalCount = 23;
  const result = await native.sortFull(mock.store, raw, 'published-desc', sortVideos);
  assert.equal(result.count, 20);
  assert.equal(mock.state.watchlaterList[0].aid, 20);
});

test('native add-time controls restore both directions after custom sorting', async () => {
  const raw = rawVideos(60).map((video, i) => ({ ...video, add_at: 5000 + i }));
  const mock = storeFor(raw, 60);
  await native.sortFull(mock.store, raw, 'duration-desc', sortVideos);
  assert.equal(mock.state.watchlaterList[0].aid, 1);
  assert.equal(native.restoreNativeOrder(mock.store, raw, '最近添加', sortVideos), 60);
  assert.deepEqual(mock.state.watchlaterList.map(v => v.aid), raw.map(v => v.aid).reverse());
  await native.sortFull(mock.store, raw, 'duration-desc', sortVideos);
  assert.equal(native.restoreNativeOrder(mock.store, raw, '最早添加', sortVideos), 60);
  assert.deepEqual(mock.state.watchlaterList.map(v => v.aid), raw.map(v => v.aid));
  assert.deepEqual(mock.state.checkedList.map(v => v.aid), raw.map(v => v.aid));
});

test('native restore refuses stale data without mutating the list', async () => {
  const raw = rawVideos(20);
  const mock = storeFor(raw, 20);
  mock.state.watchlaterList[0] = card({ aid: 999, bvid: 'BV0000000999' });
  assert.throws(() => native.restoreNativeOrder(mock.store, raw, '最近添加', sortVideos), /缓存不一致/);
  assert.equal(mock.state.watchlaterList[0].aid, 999);
});

test('stale extension sort is cancelled before applying after native click', async () => {
  const raw = rawVideos(60);
  const mock = storeFor(raw, 60);
  await assert.rejects(native.sortFull(mock.store, raw, 'duration-asc', sortVideos, () => false),
    /已切换至 B站原生排序/);
  assert.deepEqual(mock.state.watchlaterList.map(v => v.aid), raw.map(v => v.aid));
});

test('stale preloaded count is identified before fetching more native pages', async () => {
  const raw = rawVideos(60);
  const mock = storeFor(raw, 20);
  mock.state.totalCount = 59;
  await assert.rejects(
    native.sortFull(mock.store, raw, 'published-desc', sortVideos),
    err => err.code === 'WL_SORTER_STALE_METADATA' && /筛选列表数量/.test(err.message)
  );
  assert.equal(mock.loads, 0);
});

test('equal-count identity replacement signals a refresh rather than applying stale sort', async () => {
  const raw = rawVideos(20);
  const mock = storeFor(raw, 20);
  const current = raw.slice(1).concat({
    aid: 21, bvid: 'BV0000000021', pubdate: 80000, duration: 5
  });
  await assert.rejects(
    native.sortFull(mock.store, current, 'published-desc', sortVideos),
    err => err.code === 'WL_SORTER_STALE_METADATA' && /无法一一匹配/.test(err.message)
  );
  assert.deepEqual(mock.state.watchlaterList.map(x => x.aid), raw.map(x => x.aid));
});

test('foreground request interrupts native background PREPARE between batches', async () => {
  const raw = rawVideos(80);
  const mock = storeFor(raw);
  let active = true;
  let calls = 0;
  const load = mock.store.loadMoreWatchlaterList.bind(mock.store);
  mock.store.loadMoreWatchlaterList = async () => {
    await load();
    calls++;
    active = false;
  };
  await assert.rejects(native.prepare(mock.store, () => active), /后台预加载已让位/);
  assert.equal(calls, 1, 'do not load the remaining batches after user selection');
  assert.equal(mock.state.watchlaterList.length, 40);
  const result = await native.sortFull(mock.store, raw, 'published-desc', sortVideos);
  assert.equal(result.count, 80);
  assert.equal(mock.state.watchlaterList[0].aid, 80);
});
