const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(base, p), 'utf8');

test('MV3 injects complete-list API adapter before page fallback', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.version, '0.3.0');
  assert.deepEqual(m.permissions, ['storage']);
  assert.deepEqual(m.host_permissions, ['https://api.bilibili.com/*']);
  const page = m.content_scripts.find(x => x.world === 'MAIN');
  const content = m.content_scripts.find(x => x.world !== 'MAIN');
  assert.deepEqual(page.js, ['src/api.js', 'src/page-bridge.js']);
  assert.deepEqual(content.js, ['src/sort.js', 'src/content.js']);
  for (const script of m.content_scripts) {
    assert.ok(script.matches.includes('https://www.bilibili.com/watchlater*'));
    assert.ok(script.matches.includes('https://www.bilibili.com/list/watchlater*'));
    for (const file of [...(script.js || []), ...(script.css || [])])
      assert.ok(fs.existsSync(path.join(base, file)), file);
  }
  assert.ok(fs.existsSync(path.join(base, m.background.service_worker)));
});

test('full-list UI creates cards from API results rather than existing DOM cards', () => {
  const script = read('src/content.js');
  assert.match(script, /for\s*\(const video of sortVideos\(videos,\s*mode\)\)/);
  assert.match(script, /fullGrid\.replaceChildren\(fragment\)/);
  assert.match(script, /fragment\.append\(renderCard\(video\)\)/);
  assert.match(script, /#?wl-sorter-full-list/);
  assert.match(script, /nativeGrid\.style\.setProperty\('display',\s*'none',\s*'important'\)/);
  assert.match(script, /restoreNative\(\)/);
  assert.doesNotMatch(script, /style\.setProperty\('order'/);
});

test('content safeguards complete counts, original page restoration and error display', () => {
  const script = read('src/content.js');
  assert.match(script, /count !== videos\.length/);
  assert.match(script, /readDisplayedTotal\(\)/);
  assert.match(script, /expectedCount/);
  assert.match(script, /setWarning\(/);
  assert.match(script, /mode === 'default'/);
  assert.match(script, /image\.loading = 'lazy'/);
  assert.match(script, /link\.rel = 'noopener noreferrer'/);
  assert.match(script, /\\/watchlater/);
});

test('CSS displays full grid with five columns and restores native when hidden', () => {
  const css = read('src/content.css');
  assert.match(css, /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /#wl-sorter-full-list\[hidden\]/);
  assert.match(css, /#wl-sorter-warning\[hidden\]/);
});
