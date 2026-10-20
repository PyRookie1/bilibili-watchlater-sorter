const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const native = require('../src/native-sort.js');
const { sortVideos } = require('../src/sort.js');
function card(link, bvid = null) {
  return {
    getAttribute(key) { return key === 'data-bvid' ? bvid : null; },
    querySelector() { return null; },
    querySelectorAll() {
      return link ? [{ getAttribute(key) { return key === 'href' ? link : null; } }] : [];
    }
  };
}
const items = [
  { bvid:'BV1AB411c7mD', aid:21, pubdate:100, duration:300 },
  { bvid:'BV2AB411c7mD', aid:22, pubdate:300, duration:60 },
  { bvid:'BV3AB411c7mD', aid:23, pubdate:200, duration:120 }
];
test('extracts BV id from native watch-later query links', () => {
  assert.equal(native.keyFromLink('/list/watchlater?bvid=BV1AB411c7mD'), 'bv:BV1AB411c7mD');
  assert.equal(native.keyFromLink('https://www.bilibili.com/list/watchlater?bvid=BV2AB411c7mD'), 'bv:BV2AB411c7mD');
  assert.equal(native.keyFromLink('//www.bilibili.com/video/BV3AB411c7mD/'), 'bv:BV3AB411c7mD');
});
test('rejects invalid or non-Bilibili links', () => {
  assert.equal(native.keyFromLink('javascript:alert(1)'), null);
  assert.equal(native.keyFromLink('https://evil.example/list/watchlater?bvid=BV1AB411c7mD'), null);
  assert.equal(native.keyFromLink('/list/watchlater?bvid=not-bv'), null);
});
test('identifies native cards by data-bvid and their anchors', () => {
  assert.equal(native.keyFromCard(card('/video/BV1AB411c7mD')), 'bv:BV1AB411c7mD');
  assert.equal(native.keyFromCard(card(null,'BV2AB411c7mD')), 'bv:BV2AB411c7mD');
  assert.equal(native.keyFromCard(card('/video/av21')), 'av:21');
  assert.equal(native.keyFromCard(card('/something')), null);
});
test('publication and duration ranks cover the whole interface response', () => {
  let ranks = native.rankMap(items, 'published-desc', sortVideos);
  assert.equal(ranks.get('bv:BV2AB411c7mD'), 0);
  assert.equal(ranks.get('bv:BV1AB411c7mD'), 2);
  ranks = native.rankMap(items, 'duration-asc', sortVideos);
  assert.equal(ranks.get('bv:BV2AB411c7mD'), 0);
  assert.equal(ranks.get('av:23'), 1);
  assert.equal(ranks.get('bv:BV1AB411c7mD'), 2);
});
test('unknown cards are placed last and keep original relative order', () => {
  const cards = [
    card('/video/BV1AB411c7mD'),card('/unknown'),card('/video/BV2AB411c7mD'),card(null)
  ];
  const ranks = native.rankMap(items, 'duration-asc', sortVideos);
  const result = native.displayOrders(cards, ranks, items.length);
  assert.deepEqual(result.map(x => x.order), [2,4,0,6]);
  assert.deepEqual(result.map(x => x.matched), [true,false,true,false]);
});
test('v0.2 content script injects native sorter into both routes', () => {
  const base = path.resolve(__dirname, '..');
  const m = JSON.parse(fs.readFileSync(path.join(base,'manifest.json'),'utf8'));
  const isolated = m.content_scripts.find(s => s.world !== 'MAIN');
  assert.ok(isolated.js.includes('src/native-sort.js'));
  assert.ok(isolated.matches.includes('https://www.bilibili.com/watchlater*'));
  const content = fs.readFileSync(path.join(base,'src/content.js'),'utf8');
  assert.match(content,/watchlater-list-container/);
  assert.match(content,/\.video-card/);
  assert.match(content,/style\.setProperty\('order'/);
  assert.doesNotMatch(content,/wl-sorter-overlay/);
});
