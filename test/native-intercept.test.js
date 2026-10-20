const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const sortCode = fs.readFileSync(path.join(__dirname, '../src/sort.js'), 'utf8');
const interceptCode = fs.readFileSync(path.join(__dirname, '../src/native-intercept.js'), 'utf8');

function list(total = 423) {
  return Array.from({ length: total }, (_, i) => ({
    aid: i + 1,
    bvid: 'BV' + String(i + 1).padStart(10, '0'),
    pubdate: i + 1000, duration: 5000 - i, title: 'video ' + i
  }));
}
function body(items = list(), count = items.length) {
  return { code: 0, message: '0', data: { count, list: items } };
}
function harness(initialMode = 'duration-asc') {
  const events = new Map();
  const storage = new Map([['wl-sorter-mode', initialMode]]);
  const calls = [];
  const state = { payload: body() };
  const fakeDocument = { querySelector: () => state.grid || null };
  const sandbox = {
    URL, Request, Response, Headers, setTimeout, clearTimeout,
    location: { origin: 'https://www.bilibili.com', href: 'https://www.bilibili.com/watchlater/list#/list' },
    document: fakeDocument,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    },
    addEventListener: (type, handler) => events.set(type, handler),
    postMessage: data => calls.push(data),
    fetch: async url => new Response(JSON.stringify(state.payload), { status: 200 }),
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(sortCode, sandbox);
  vm.runInNewContext(interceptCode, sandbox);
  return { sandbox, events, state, calls, storage };
}

test('sorts all 423 items in the original fetch response before native rendering', async () => {
  const { sandbox, state } = harness();
  const result = await sandbox.fetch('https://api.bilibili.com/x/v2/history/toview/web?jsonp=jsonp');
  const items = (await result.json()).data.list;
  assert.equal(items.length, 423);
  assert.equal(items[0].aid, 423);
  assert.equal(items[422].aid, 1);
  assert.equal(state.payload.data.list[0].aid, 1, 'original raw payload remains intact');
});

test('does not intercept mutations or unrelated endpoints', async () => {
  const { sandbox, state } = harness();
  for (const url of [
    'https://api.bilibili.com/x/v2/history/toview/del',
    'https://api.bilibili.com/x/v2/history/toview/add',
    'https://api.bilibili.com/x/v3/fav/resource/list'
  ]) {
    const response = await sandbox.fetch(url);
    assert.deepEqual((await response.json()).data.list[0].aid, state.payload.data.list[0].aid);
  }
});

test('never sorts an incomplete response', async () => {
  const { sandbox, state } = harness();
  state.payload = body(list(40), 423);
  const result = await sandbox.fetch('https://api.bilibili.com/x/v2/history/toview');
  assert.equal((await result.json()).data.list[0].aid, 1);
});

test('changing mode resorts the full Vue state in-place without DOM replacement', async () => {
  const { sandbox, state, events, storage, calls } = harness();
  await sandbox.fetch('https://api.bilibili.com/x/v2/history/toview');
  const original = list();
  const vueItems = original.slice();
  const instance = { setupState: { videoList: vueItems }, parent: null };
  state.grid = { __vueParentComponent: instance, parentElement: null };
  const handler = events.get('message');
  handler({
    source: vm.runInNewContext('globalThis', sandbox), origin: 'https://www.bilibili.com',
    data: { channel: 'wl-sorter-bilibili-v1', type: 'SET_MODE', id: '1', mode: 'published-desc' }
  });
  assert.equal(vueItems.length, 423);
  assert.equal(vueItems[0].aid, 423);
  assert.equal(vueItems[422].aid, 1);
  assert.equal(storage.get('wl-sorter-mode'), 'published-desc');
  assert.equal(calls.at(-1).applied, true);
  handler({
    source: vm.runInNewContext('globalThis', sandbox), origin: 'https://www.bilibili.com',
    data: { channel: 'wl-sorter-bilibili-v1', type: 'SET_MODE', id: '2', mode: 'default' }
  });
  assert.equal(vueItems[0].aid, 1);
});

test('ignores invalid sort mode messages', () => {
  const { sandbox, events, calls } = harness();
  events.get('message')({
    source: vm.runInNewContext('globalThis', sandbox), origin: 'https://www.bilibili.com',
    data: { channel: 'wl-sorter-bilibili-v1', type: 'SET_MODE', mode: 'malicious' }
  });
  assert.equal(calls.length, 0);
});
