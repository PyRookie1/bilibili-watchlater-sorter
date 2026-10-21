const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../src/native-intercept.js'), 'utf8');
const channel = 'wl-sorter-bilibili-v1';
const id = '123e4567-e89b-12d3-a456-426614174000';

function harness({ failure = null } = {}) {
  const posted = [];
  let onMessage;
  const window = {
    addEventListener(type, listener) { if (type === 'message') onMessage = listener; },
    postMessage(message) { posted.push(message); }
  };
  const calls = [];
  const core = {
    assertMetadata(raw) {
      if (!Array.isArray(raw) || raw.length !== 424) throw Error('incomplete');
    },
    findStore(grid) { return grid ? { totalCount: 424 } : null; },
    async sortFull(store, raw, mode) {
      calls.push({ store, raw, mode });
      if (failure) throw Error(failure);
      return { ok: true, count: raw.length };
    }
  };
  const scope = {
    window,
    location: { origin: 'https://www.bilibili.com' },
    document: { querySelector: () => ({}) },
    WatchLaterSort: {
      isSortMode: mode => ['default','duration-asc','published-desc'].includes(mode),
      sortVideos: records => records
    },
    WatchLaterFullNative: core,
    Promise
  };
  vm.runInNewContext(src, scope);
  return {
    posted, calls, window,
    async send(data, origin = 'https://www.bilibili.com') {
      onMessage({ source: window, origin, data: { channel, id, ...data } });
      await new Promise(resolve => setImmediate(resolve));
    }
  };
}
const videos = Array.from({length:424}, (_, i) => ({ aid:i+1 }));

test('MAIN-world bridge delegates all 424 records to native Pinia sorter', async () => {
  const h = harness();
  await h.send({ type:'SET_MODE', mode:'duration-asc', items:videos });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].raw.length, 424);
  assert.equal(h.posted.length, 1);
  assert.equal(h.posted[0].ok, true);
  assert.equal(h.posted[0].count, 424);
});

test('the bridge reports incomplete sorting as an error rather than success', async () => {
  const h = harness({failure:'原生列表只加载到 20/424'});
  await h.send({ type:'SET_MODE', mode:'duration-asc', items:videos });
  assert.equal(h.posted.length, 1);
  assert.equal(h.posted[0].ok, false);
  assert.match(h.posted[0].error, /20\/424/);
});

test('rejects untrusted message origin, invalid modes and invalid IDs', async () => {
  const h = harness();
  await h.send({ type:'SET_MODE', mode:'duration-asc', items:videos }, 'https://evil.example');
  await h.send({ type:'SET_MODE', mode:'bogus', items:videos });
  await h.send({ type:'SET_MODE', mode:'duration-asc', items:videos, id:'wl-bad-id' });
  assert.equal(h.calls.length, 0);
  assert.equal(h.posted.length, 0);
});
