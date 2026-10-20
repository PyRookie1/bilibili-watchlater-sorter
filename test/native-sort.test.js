const test = require('node:test');
const assert = require('node:assert/strict');
const native = require('../src/native-sort.js');
const { sortVideos } = require('../src/sort.js');
const items = [
  { bvid: 'BV1AB411c7mD', aid: 11, pubdate: 1000, duration: 100 },
  { bvid: 'BV2AB411c7mD', aid: 22, pubdate: 3000, duration: 300 },
  { bvid: 'BV3AB411c7mD', aid: 33, pubdate: 2000, duration: 200 }
];
function card(href, bvid = null) {
  return {
    getAttribute(name) { return name === 'data-bvid' ? bvid : null; },
    querySelector() { return null; },
    querySelectorAll() { return href ? [{ getAttribute() { return href; } }] : []; }
  };
}
test('Bilibili native links accept BV, AV, and query parameters', () => {
  assert.equal(native.keyFromLink('https://www.bilibili.com/video/BV1AB411c7mD'), 'bv:BV1AB411c7mD');
  assert.equal(native.keyFromLink('/watchlater/list?bvid=BV1AB411c7mD'), 'bv:BV1AB411c7mD');
  assert.equal(native.keyFromLink('//www.bilibili.com/video/av11'), 'av:11');
  assert.equal(native.keyFromLink('/watchlater/list?aid=11'), 'av:11');
  assert.equal(native.keyFromLink('https://malicious.tld/?bvid=BV1AB411c7mD'), null);
  assert.equal(native.keyFromLink('javascript:alert(1)'), null);
});
test('maps full data order to native cards without replacing DOM', () => {
  const ranks = native.ranksFromVideos(items, 'published-desc', sortVideos);
  const originals = [
    { host: { id:'a' }, card: card('/video/BV1AB411c7mD') },
    { host: { id:'b' }, card: card('/video/BV2AB411c7mD') },
    { host: { id:'c' }, card: card('/video/BV3AB411c7mD') }
  ];
  const result = native.matchNativeEntries(originals, ranks, 3);
  assert.equal(result.complete, true);
  assert.deepEqual(result.ranked.map(x => x.rank), [2,0,1]);
  assert.equal(result.ranked[0].host, originals[0].host);
});
test('refuses partial, unmatched, duplicate, and miscounted cards', () => {
  const ranks = native.ranksFromVideos(items, 'duration-asc', sortVideos);
  const valid = [
    { host: {}, card: card('/video/BV1AB411c7mD') },
    { host: {}, card: card('/video/BV2AB411c7mD') },
    { host: {}, card: card('/video/BV3AB411c7mD') }
  ];
  assert.equal(native.matchNativeEntries(valid.slice(0,2),ranks,3).complete,false);
  assert.equal(native.matchNativeEntries(valid.concat(valid[1]),ranks,4).complete,false);
  assert.equal(native.matchNativeEntries([valid[0],valid[0],valid[2]],ranks,3).complete,false);
  assert.equal(native.matchNativeEntries([{host:{},card:card('/watchlater/list')},...valid.slice(1)],ranks,3).complete,false);
});

test('progressively orders 15 visible cards using ranks from all 423 metadata records', () => {
  const all = Array.from({length:423}, (_,i) => ({
    bvid: 'BV' + String(i+1).padStart(10, '0'),
    aid: i+1, duration: 1000-i, pubdate: 1000+i
  }));
  const ranks = native.ranksFromVideos(all, 'duration-asc', sortVideos);
  const subset = all.slice(0,15).map(video => ({
    host: { originalId: video.aid },
    card: card('/video/' + video.bvid)
  }));
  const result = native.matchNativeEntries(subset, ranks, all.length);
  assert.equal(result.complete, false);
  assert.equal(result.usable, true);
  assert.equal(result.matched, 15);
  assert.equal(result.ranked[0].order, 422);
  assert.equal(result.ranked[14].order, 408);
  assert.equal(result.ranked[0].host, subset[0].host);
});
test('unmatched native cards follow ranked cards without crashing sorting', () => {
  const ranks = native.ranksFromVideos(items, 'duration-asc', sortVideos);
  const source = [
    { host: { id:'a' }, card: card('/video/BV3AB411c7mD') },
    { host: { id:'x' }, card: card('/unknown') },
    { host: { id:'b' }, card: card('/video/BV1AB411c7mD') }
  ];
  const result = native.matchNativeEntries(source,ranks,3);
  assert.equal(result.usable,true);
  assert.equal(result.complete,false);
  assert.deepEqual(result.ranked.map(item=>item.order),[1,4,0]);
});
