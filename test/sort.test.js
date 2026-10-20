const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {sortVideos,isSortMode,formatDuration,formatPublished,videoLink,coverLink} = require('../src/sort.js');
const items = [
  {bvid:'BV1AB411c7mD',pubdate:1000,duration:220},
  {bvid:'BV2AB411c7mD',pubdate:2000,duration:400},
  {bvid:'BV3AB411c7mD',pubdate:1000,duration:100},
  {bvid:'BV4AB411c7mD',pubdate:3000,duration:100}
];
const ids = xs => xs.map(x => x.bvid);
test('sorts by publication date in both directions, stable ties', () => {
  assert.deepEqual(ids(sortVideos(items,'published-desc')),['BV4AB411c7mD','BV2AB411c7mD','BV1AB411c7mD','BV3AB411c7mD']);
  assert.deepEqual(ids(sortVideos(items,'published-asc')),['BV1AB411c7mD','BV3AB411c7mD','BV2AB411c7mD','BV4AB411c7mD']);
});
test('sorts by total duration in both directions', () => {
  assert.deepEqual(ids(sortVideos(items,'duration-asc')),['BV3AB411c7mD','BV4AB411c7mD','BV1AB411c7mD','BV2AB411c7mD']);
  assert.deepEqual(ids(sortVideos(items,'duration-desc')),['BV2AB411c7mD','BV1AB411c7mD','BV3AB411c7mD','BV4AB411c7mD']);
});
test('default order does not mutate source', () => {
  const before = ids(items);
  assert.deepEqual(ids(sortVideos(items,'default')),before);
  assert.deepEqual(ids(sortVideos(items,'unknown')),before);
  sortVideos(items,'duration-asc');
  assert.deepEqual(ids(items),before);
  assert.notEqual(sortVideos(items,'default'),items);
});
test('missing and invalid metadata always sorts last', () => {
  const a = [{id:'missing'},{id:'valid',duration:35},{id:'zero',duration:0},{id:'invalid',duration:'999'}];
  for (const mode of ['duration-asc','duration-desc'])
    assert.deepEqual(sortVideos(a,mode).map(x=>x.id),['valid','missing','zero','invalid']);
});
test('handles null, empty and singleton inputs', () => {
  assert.deepEqual(sortVideos(null,'published-asc'),[]);
  assert.deepEqual(sortVideos([],'duration-desc'),[]);
  assert.deepEqual(sortVideos([{duration:50}],'duration-asc'),[{duration:50}]);
});
test('validates sort modes and displays durations', () => {
  assert.equal(isSortMode('published-desc'),true);
  assert.equal(isSortMode('__proto__'),false);
  assert.equal(formatDuration(61),'1:01');
  assert.equal(formatDuration(3661),'1:01:01');
  assert.equal(formatDuration(0),'时长未知');
  assert.equal(formatPublished(0),'发布时间未知');
});
test('validates video and cover URLs', () => {
  assert.equal(videoLink({bvid:'BV1AB411c7mD'}),'https://www.bilibili.com/list/watchlater?bvid=BV1AB411c7mD');
  assert.equal(videoLink({bvid:'bad',aid:123}),'https://www.bilibili.com/video/av123');
  assert.equal(videoLink({bvid:'javascript:alert(1)'}),null);
  assert.equal(coverLink('http://i0.hdslb.com/bfs/archive/x.jpg'),'https://i0.hdslb.com/bfs/archive/x.jpg');
  assert.equal(coverLink('javascript:alert(1)'),null);
  assert.equal(coverLink('https://evil.example/image.jpg'),null);
});
test('MV3 manifest permissions are narrow and referenced files exist', () => {
  const base = path.resolve(__dirname,'..');
  const m = JSON.parse(fs.readFileSync(path.join(base,'manifest.json'),'utf8'));
  assert.equal(m.manifest_version,3);
  assert.deepEqual(m.permissions,['storage']);
  assert.deepEqual(m.host_permissions,['https://api.bilibili.com/*']);
  for (const rule of m.content_scripts) {
    assert.deepEqual(rule.matches,['https://www.bilibili.com/watchlater*','https://www.bilibili.com/list/watchlater*']);
    for (const file of [...(rule.js||[]),...(rule.css||[])])
      assert.ok(fs.existsSync(path.join(base,file)),file);
  }
  assert.ok(fs.existsSync(path.join(base,m.background.service_worker)));
});
