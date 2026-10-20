const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCompleteResponse, fetchCompleteList, ENDPOINTS } = require('../src/api.js');
const { sortVideos } = require('../src/sort.js');

function video(i) {
  return {
    aid: i + 1, bvid: 'BV' + String(i + 1).padStart(10, '0'),
    title: '视频 ' + i, pubdate: 100000 + i * 50,
    duration: 8000 - i * 10, pic: '//i0.hdslb.com/bfs/archive/test.jpg',
    owner: { name: 'UP主 ' + i }, secretField: 'not exposed'
  };
}
function payload(count, countInList = count) {
  return { code: 0, data: { count, list: Array.from({ length: countInList }, (_, i) => video(i)) } };
}
function jsonResponse(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

test('parses all 423 records, preserves total and whitelists fields', () => {
  const result = parseCompleteResponse(payload(423));
  assert.equal(result.count, 423);
  assert.equal(result.items.length, 423);
  assert.equal(result.items[0].owner, 'UP主 0');
  assert.equal(Object.hasOwn(result.items[0], 'secretField'), false);
  assert.deepEqual(sortVideos(result.items, 'duration-asc').slice(0, 3).map(v => v.aid), [423, 422, 421]);
  assert.deepEqual(sortVideos(result.items, 'published-desc').slice(0, 3).map(v => v.aid), [423, 422, 421]);
});

test('fails closed for truncated, missing-count and malformed responses', () => {
  assert.throws(() => parseCompleteResponse(payload(423, 100)), /100 \/ 423/);
  assert.throws(() => parseCompleteResponse({ code: 0, data: { list: [video(1)] } }), /有效总数/);
  assert.throws(() => parseCompleteResponse({ code: 0, data: { count: 1, list: [null] } }), /视频数据无效/);
  assert.throws(() => parseCompleteResponse({ code: -101 }), /未登录/);
  assert.throws(() => parseCompleteResponse({ code: 0, data: { count: 0, list: null } }), /没有返回列表/);
  assert.equal(parseCompleteResponse(payload(0)).items.length, 0);
});

test('uses documented default endpoint when it is already complete', async () => {
  const calls = [];
  const result = await fetchCompleteList(async (url, options) => {
    calls.push({ url, options });
    return jsonResponse(payload(423));
  });
  assert.equal(result.items.length, 423);
  assert.equal(result.count, 423);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ENDPOINTS[0]);
  assert.equal(calls[0].options.credentials, 'include');
});

test('falls back to web variant if the first API only returns 100 of 423', async () => {
  const urls = [];
  const result = await fetchCompleteList(async url => {
    urls.push(url);
    return jsonResponse(url === ENDPOINTS[0] ? payload(423, 100) : payload(423));
  });
  assert.deepEqual(urls, [...ENDPOINTS]);
  assert.equal(result.count, 423);
  assert.equal(result.items.length, 423);
  assert.equal(result.endpoint, ENDPOINTS[1]);
});

test('never passes a partial list through if both API variants are truncated', async () => {
  await assert.rejects(
    fetchCompleteList(async () => jsonResponse(payload(423, 100))),
    /无法读取完整稍后再看列表.*100 \/ 423/
  );
});

test('falls back on HTTP error and reports both errors on failure', async () => {
  const result = await fetchCompleteList(async url =>
    jsonResponse(url === ENDPOINTS[0] ? {} : payload(2), url === ENDPOINTS[0] ? 412 : 200));
  assert.equal(result.items.length, 2);
  await assert.rejects(
    fetchCompleteList(async () => jsonResponse({}, 503)),
    /常规接口：HTTP 503.*网页接口：HTTP 503/
  );
});

test('treats reported 100/100 as incomplete when page heading says 423', async () => {
  const urls = [];
  const result = await fetchCompleteList(async url => {
    urls.push(url);
    return jsonResponse(url === ENDPOINTS[0] ? payload(100) : payload(423));
  }, { expectedCount: 423 });
  assert.equal(result.items.length, 423);
  assert.deepEqual(urls, [...ENDPOINTS]);

  await assert.rejects(
    fetchCompleteList(async () => jsonResponse(payload(100)), { expectedCount: 423 }),
    /页面显示 423 条，但接口只返回 100 条/
  );
});
