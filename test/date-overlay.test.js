const test = require('node:test');
const assert = require('node:assert/strict');
const overlay = require('../src/date-overlay.js');
const { formatPublished } = require('../src/sort.js');

global.getComputedStyle = () => ({ position: 'static' });

function fakeClassList() {
  const list = new Set();
  return { add: s => list.add(s), remove: s => list.delete(s), contains: s => list.has(s) };
}
function nativeCard(href, options = {}) {
  const badges = [];
  const doc = {
    createElement(tag) {
      assert.equal(tag, 'span');
      return {
        className: '', parentElement: null, textContent: '',
        attrs: {}, setAttribute(key, value) { this.attrs[key] = value; },
        remove() {
          if (this.parentElement) {
            const index = badges.indexOf(this);
            if (index >= 0) badges.splice(index, 1);
          }
          this.parentElement = null;
        }
      };
    }
  };
  const host = {
    tagName: 'DIV',
    classList: fakeClassList(),
    append(node) { node.parentElement = this; badges.push(node); }
  };
  const img = { closest(selector) {
    return selector.includes('[class*="cover"]') ? host : null;
  } };
  const card = {
    ownerDocument: doc,
    getAttribute(name) {
      if (name === 'data-bvid') return options.bvid || null;
      return null;
    },
    querySelector(selector) {
      if (selector.includes('img')) return img;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'a[href]') return [
        { getAttribute: name => name === 'href' ? href : null }
      ];
      if (selector === '.wl-sorter-published') return badges.slice();
      return [];
    },
    contains(candidate) { return candidate === host; }
  };
  const grid = { querySelectorAll: selector => selector === '.video-card' ? [card] : [] };
  return { card, host, badges, grid, setHref(value) { href = value; } };
}
function publication(aid, timestamp) {
  return { aid, bvid: 'BV' + String(aid).padStart(10, '0'), pubdate: timestamp };
}
const timestamp = Date.UTC(2026, 6, 12, 12) / 1000;

test('dates derive from the complete API records and ignore missing timestamps', () => {
  const dates = overlay.dateMap([
    publication(1, timestamp),
    publication(2, 0),
    publication(3, Number.NaN)
  ], formatPublished);
  assert.equal(dates.get('bv:BV0000000001'), '2026-07-12');
  assert.equal(dates.get('av:1'), '2026-07-12');
  assert.equal(dates.has('bv:BV0000000002'), false);
  assert.equal(dates.has('av:3'), false);
});

test('matches Bilibili BV/AV card links but not unrelated domains', () => {
  assert.equal(overlay.keyFromHref('/video/BV0000000001'), 'bv:BV0000000001');
  assert.equal(overlay.keyFromHref('/list/watchlater?bvid=BV0000000001'), 'bv:BV0000000001');
  assert.equal(overlay.keyFromHref('https://www.bilibili.com/video/av123'), 'av:123');
  assert.equal(overlay.keyFromHref('https://evil.invalid/video/BV0000000001'), null);
  assert.equal(overlay.keyFromHref('javascript:alert(1)'), null);
});

test('adds one date to a real card cover without changing video links', () => {
  const native = nativeCard('/list/watchlater?bvid=BV0000000001');
  const dates = overlay.dateMap([publication(1, timestamp)], formatPublished);
  const first = overlay.render(native.grid, dates);
  assert.deepEqual(first, { shown: 1, cards: 1 });
  assert.equal(native.badges.length, 1);
  assert.equal(native.badges[0].textContent, '2026-07-12');
  assert.equal(native.badges[0].attrs['aria-label'], '发布时间：2026-07-12');
  assert.equal(native.badges[0].parentElement, native.host);
  assert.ok(native.host.classList.contains('wl-sorter-cover-relative'));
  const badge = native.badges[0];
  const second = overlay.render(native.grid, dates);
  assert.equal(second.shown, 1);
  assert.equal(native.badges.length, 1, 'mutation observer must not duplicate badges');
  assert.equal(native.badges[0], badge);
});

test('correctly updates a recycled native card on later list renders', () => {
  const native = nativeCard('/video/BV0000000001');
  const dates = overlay.dateMap([publication(1, timestamp),
    publication(2, timestamp + 86400)], formatPublished);
  overlay.render(native.grid, dates);
  native.setHref('/video/BV0000000002');
  overlay.render(native.grid, dates);
  assert.equal(native.badges.length, 1);
  assert.equal(native.badges[0].textContent, '2026-07-13');
});

test('clears all date badges and restores wrapper layout on default mode', () => {
  const native = nativeCard('/video/BV0000000001');
  overlay.render(native.grid, overlay.dateMap([publication(1, timestamp)], formatPublished));
  overlay.clear(native.grid);
  assert.equal(native.badges.length, 0);
  assert.equal(native.host.classList.contains('wl-sorter-cover-relative'), false);
});

test('unmatched videos or missing cover never receive an incorrect date', () => {
  const native = nativeCard('/video/BV0000000003');
  const dates = overlay.dateMap([publication(1, timestamp)], formatPublished);
  assert.equal(overlay.render(native.grid, dates).shown, 0);
  assert.equal(native.badges.length, 0);
});
