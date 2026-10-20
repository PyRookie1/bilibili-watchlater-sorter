const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const WatchLaterApi = require('../src/api.js');
const source = fs.readFileSync(path.join(__dirname, '../src/background.js'), 'utf8');

function fixture(n, returned = n) {
  return {
    code: 0,
    data: {
      count: n,
      list: Array.from({ length: returned }, (_, i) => ({
        aid: i + 1, title: 'Demo ' + i, bvid: 'BV' + String(i).padStart(10, '0'),
        duration: i + 10, pubdate: 100 + i, owner: { name: 'Uploader' }, confidential: 'do-not-forward'
      }))
    }
  };
}
function harness(responses = [fixture(1)]) {
  let listener;
  let action;
  const calls = [];
  const chrome = {
    runtime: { id: 'extension-test-id', onMessage: { addListener(fn) { listener = fn; } } },
    action: { onClicked: { addListener(fn) { action = fn; } } },
    tabs: { sendMessage() {}, create() {} }
  };
  const fetch = async (url, options) => {
    calls.push({ url, options });
    const response = responses[Math.min(calls.length - 1, responses.length - 1)];
    const status = response?.status || 200;
    return { ok: status >= 200 && status < 300, status, async json() { return response?.body || response; } };
  };
  vm.runInNewContext(source, { chrome, fetch, WatchLaterApi, importScripts() {}, URL, console });
  const sender = { id: chrome.runtime.id, url: 'https://www.bilibili.com/watchlater/list#/list' };
  const request = (from = sender) => new Promise((resolve, reject) => {
    try {
      const reply = listener({ type: 'WL_SORTER_FETCH' }, from, resolve);
      if (reply === false) resolve('rejected');
    } catch (error) { reject(error); }
  });
  return { request, calls, action };
}

test('background returns complete watch later records and only allowed fields', async () => {
  const { request, calls } = harness([fixture(423)]);
  const result = await request();
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 423);
  assert.equal(result.count, 423);
  assert.equal(result.items[0].owner, 'Uploader');
  assert.equal(Object.hasOwn(result.items[0], 'confidential'), false);
  assert.equal(calls[0].url, WatchLaterApi.ENDPOINTS[0]);
  assert.equal(calls[0].options.credentials, 'include');
});

test('background falls back when first response is incomplete', async () => {
  const { request, calls } = harness([fixture(423, 100), fixture(423)]);
  const result = await request();
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 423);
  assert.equal(calls.length, 2);
});

test('background never treats 100/423 as full list', async () => {
  const { request } = harness([fixture(423, 100)]);
  const result = await request();
  assert.equal(result.ok, false);
  assert.match(result.error, /100 \/ 423/);
});

test('rejects requests outside watch later and from other extensions', async () => {
  const { request, calls } = harness();
  for (const from of [
    { id: 'other', url: 'https://www.bilibili.com/watchlater/list#/list' },
    { id: 'extension-test-id', url: 'https://evil.example/watchlater' },
    { id: 'extension-test-id', url: 'https://www.bilibili.com/video/BV1AB411c7mD' },
    { id: 'extension-test-id', url: 'https://www.bilibili.com/watchlater-evil' }
  ]) assert.equal(await request(from), 'rejected');
  assert.equal(calls.length, 0);
});

test('returns API errors and accepts legacy and modern page URLs', async () => {
  const { request } = harness([{ code: -101 }]);
  assert.match((await request()).error, /未登录/);
  for (const url of [
    'https://www.bilibili.com/watchlater/list#/list',
    'https://www.bilibili.com/watchlater/#/list',
    'https://www.bilibili.com/list/watchlater'
  ]) {
    const ctx = harness([fixture(0)]);
    assert.equal((await ctx.request({ id: 'extension-test-id', url })).ok, true);
  }
});
