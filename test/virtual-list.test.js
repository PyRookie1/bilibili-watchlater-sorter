const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/sort.js');
const view = require('../src/virtual-list.js');

test('virtual list renders only a bounded number of rows at any position', () => {
  const count = 10000;
  for (const top of [0, 112, 11000, 555000, 999999]) {
    const { first, last } = view.visibleRange(top, 700, count);
    assert.ok(first >= 0 && first < count);
    assert.ok(last <= count && last - first <= 18);
  }
});
