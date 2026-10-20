const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(base, p), 'utf8');

test('MV3 loads all native sorting and API scripts with limited permissions', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.version, '0.4.0');
  assert.deepEqual(m.permissions, ['storage']);
  assert.deepEqual(m.host_permissions, ['https://api.bilibili.com/*']);
  const main = m.content_scripts.find(s => s.world === 'MAIN');
  const isolated = m.content_scripts.find(s => s.world !== 'MAIN');
  assert.deepEqual(main.js, ['src/api.js', 'src/page-bridge.js']);
  assert.deepEqual(isolated.js, ['src/sort.js', 'src/native-sort.js', 'src/content.js']);
  for (const script of m.content_scripts) {
    assert.ok(script.matches.includes('https://www.bilibili.com/watchlater*'));
    assert.ok(script.matches.includes('https://www.bilibili.com/list/watchlater*'));
    for (const file of [...(script.js || []), ...(script.css || [])])
      assert.ok(fs.existsSync(path.join(base, file)), file);
  }
});

test('native view never inserts replacement video cards or hides the native grid', () => {
  const script = read('src/content.js');
  const css = read('src/content.css');
  assert.match(script, /querySelectorAll\('\.video-card'\)/);
  assert.match(script, /matchNativeEntries/);
  assert.match(script, /host\.style\.setProperty\('order', String\(rank\), 'important'\)/);
  assert.match(script, /restoreNativeOrders\(\)/);
  assert.match(script, /materializeNativeCards\(token\)/);
  assert.match(script, /readDisplayedTotal\(\)/);
  assert.match(script, /fetchCompleteList\(\)/);
  assert.doesNotMatch(script, /renderCard\(|replaceChildren\(|createElement\('article'\)|fullGrid/);
  assert.doesNotMatch(script, /nativeGrid\.style\.setProperty\('display'/);
  assert.doesNotMatch(css, /#wl-sorter-full-list|#wl-sorter-warning/);
});

test('automatic native lazy-load has bounded steps, interruption and scroll restore', () => {
  const script = read('src/content.js');
  assert.match(script, /let i = 0; i < 150; i\+\+/);
  assert.match(script, /window\.addEventListener\('wheel'/);
  assert.match(script, /window\.addEventListener\('touchstart'/);
  assert.match(script, /scroller\.scrollTop = startTop/);
  assert.match(script, /unchangedAtEnd >= 12/);
  assert.match(script, /state = 'failed'/);
});
