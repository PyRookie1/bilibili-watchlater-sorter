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

test('XHR response interception preserves native response shape and API write requests', () => {
  const events = new Map();
  class FakeXHR {
    constructor() { this.readyState = 0; this.status = 200; this.responseType = ''; this._payload = body(); }
    open(method, url) { this.method = method; this.url = url; this.readyState = 1; }
    get responseText() { return JSON.stringify(this._payload); }
    get response() { return this.responseType === 'json' ? this._payload : this.responseText; }
  }
  const store = new Map([['wl-sorter-mode','published-desc']]);
  const scope = {
    URL, Request, Response, Headers, setTimeout, clearTimeout,
    XMLHttpRequest: FakeXHR,
    location: { origin: 'https://www.bilibili.com', href: 'https://www.bilibili.com/watchlater/list#/list' },
    document: { querySelector() { return null; } },
    localStorage: { getItem: key => store.get(key), setItem: (key,val) => store.set(key,val) },
    addEventListener: (name, callback) => events.set(name,callback),
    postMessage() {},
    fetch: async () => new Response(JSON.stringify(body()), { status: 200 })
  };
  scope.globalThis = scope;
  vm.runInNewContext(sortCode, scope);
  vm.runInNewContext(interceptCode, scope);
  const xhr = new scope.XMLHttpRequest();
  xhr.open('GET','https://api.bilibili.com/x/v2/history/toview/web?jsonp=jsonp');
  xhr.readyState = 4;
  assert.equal(JSON.parse(xhr.responseText).data.list[0].aid, 423);
  assert.equal(JSON.parse(xhr.response).data.list[0].aid, 423);
  const jsonXHR = new scope.XMLHttpRequest();
  jsonXHR.responseType = 'json';
  jsonXHR.open('GET','https://api.bilibili.com/x/v2/history/toview');
  jsonXHR.readyState = 4;
  assert.equal(jsonXHR.response.data.list[0].aid, 423);
  const write = new scope.XMLHttpRequest();
  write.open('POST','https://api.bilibili.com/x/v2/history/toview/del');
  write.readyState = 4;
  assert.equal(JSON.parse(write.responseText).data.list[0].aid, 1);
});

test('sorting works even when Bilibili never calls an intercepted list endpoint', () => {
  const { sandbox, events, state, calls } = harness('default');
  // Native Vue state exists, but its list came from another internal API.
  const full = list();
  const vue = { setupState: { state: { records: full } }, parent: null };
  state.grid = { __vueParentComponent: vue, parentElement: null };
  events.get('message')({
    source: vm.runInNewContext('globalThis', sandbox), origin: 'https://www.bilibili.com',
    data: { channel: 'wl-sorter-bilibili-v1', type: 'SET_MODE',
      id: 'page-independent', mode: 'duration-asc', items: list(), count: 423 }
  });
  assert.equal(full[0].aid, 423);
  assert.equal(calls.at(-1).applied, true);
});

test('snapshot request returns full original list when intercepted', async () => {
  const { sandbox, events, calls } = harness();
  await sandbox.fetch('https://api.bilibili.com/x/v2/history/toview');
  events.get('message')({
    source: vm.runInNewContext('globalThis', sandbox), origin: 'https://www.bilibili.com',
    data: { channel: 'wl-sorter-bilibili-v1', type: 'GET_SNAPSHOT', id: 'snapshot' }
  });
  assert.equal(calls.at(-1).type, 'SNAPSHOT_RESULT');
  assert.equal(calls.at(-1).items.length, 423);
  assert.equal(calls.at(-1).items[0].aid, 1);
});
