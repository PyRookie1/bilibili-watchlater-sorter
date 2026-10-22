const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(base, name), 'utf8');

test('v0.8.11 prefetches data at document_start before UI arrives', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.version, '0.8.11');
  const main = manifest.content_scripts.find(item => item.world === 'MAIN');
  const early = manifest.content_scripts.find(item =>
    item.world !== 'MAIN' && item.js.includes('src/preload.js'));
  const isolated = manifest.content_scripts.find(item =>
    item.world !== 'MAIN' && item.js.includes('src/content.js'));
  assert.equal(main.run_at, 'document_start');
  assert.equal(early.run_at, 'document_start');
  assert.deepEqual(early.js, ['src/preload.js']);
  assert.deepEqual(isolated.js, ['src/sort.js', 'src/date-overlay.js', 'src/content.js']);
  assert.deepEqual(main.js, [
    'src/sort.js', 'src/full-native.js', 'src/native-intercept.js',
    'src/api.js', 'src/page-bridge.js'
  ]);
  for (const rule of manifest.content_scripts)
    for (const script of rule.js)
      assert.ok(fs.existsSync(path.join(base, script)), script);
});

test('the original native dropdown receives the four extra menu entries', () => {
  const content = read('src/content.js');
  const css = read('src/content.css');
  assert.match(content, /function findNativeMenu\(\)/);
  assert.match(content, /recent\.row\.parentElement !== oldest\.row\.parentElement/);
  assert.match(content, /cloneMenuOption\(oldest, value, caption, title\)/);
  assert.match(content, /menu\.insertBefore\(option, after\.nextSibling\)/);
  assert.match(content, /data-wl-sorter-native-option/);
  assert.match(content, /returnToNative/);
  assert.match(content, /document\.addEventListener\('click', returnToNative, true\)/);
  for (const title of ['最新发布', '最早发布', '时长最短', '时长最长'])
    assert.ok(content.includes(title), title);
  assert.doesNotMatch(content, /wl-sorter-root|createElement\('select'\)|createElement\('button'\)/);
  assert.doesNotMatch(css, /#wl-sorter-root|wl-sorter-button|wl-sorter-select/);
  assert.match(css, /\.wl-sorter-published/);
  assert.doesNotMatch(content, /localStorage\.getItem|localStorage\.setItem|wl-sorter-mode/);
});

test('preload begins silently on page mount and metadata is reused on selection', () => {
  const content = read('src/content.js');
  const preload = read('src/preload.js');
  assert.match(preload, /WatchLaterEarlyDataPromise/);
  assert.match(preload, /chrome\.runtime\.sendMessage\(\{ type: 'WL_SORTER_FETCH' \}\)/);
  assert.match(content, /globalThis\.WatchLaterEarlyDataPromise/);
  assert.match(content, /function fullData\(fresh = false\)/);
  assert.match(content, /if \(!dataPromise\)/);
  assert.match(content, /function beginPreload\(\)/);
  assert.match(content, /void fullData\(\)\.catch/);
  assert.match(content, /void requestPage\('PREPARE', \{\}, 120000\)/);
  assert.match(content, /if \(mount\(\)\) \{\s*beginPreload\(\);/);
  assert.match(content, /requestPage\('SET_MODE', \{ mode: next, items \}/);
  assert.match(content, /option\.addEventListener\('click'/);
});

test('no CSS card sort, forced page scroll, refresh, or extra view', () => {
  for (const name of ['src/content.js', 'src/full-native.js', 'src/native-intercept.js']) {
    const code = read(name);
    assert.doesNotMatch(code, /\.scrollTop\s*=|scrollIntoView|window\.scrollTo|location\.reload\(/);
    assert.doesNotMatch(code, /createElement\('article'\)|fullGrid|wl-sorter-full-list/);
    assert.doesNotMatch(code, /style\.setProperty\('order'|sortVisibleCards\(/);
  }
});

test('selection only succeeds on complete native Pinia state', () => {
  const content = read('src/content.js');
  const native = read('src/full-native.js');
  assert.match(content, /if \(!result\?\.ok\)/);
  assert.match(content, /全量排序失败：/);
  assert.match(native, /await materialize\(store, raw\)/);
  assert.match(native, /原生列表只加载到/);
  assert.match(native, /原生视频与接口完整列表无法一一匹配/);
});


test('publication dates appear only after successful publication-date sorting', () => {
  const source = read('src/content.js');
  const css = read('src/content.css');
  assert.match(source, /const dateOverlay = globalThis\.WatchLaterDateOverlay/);
  assert.match(source, /activeDates = dateOverlay\.dateMap\(items, formatPublished\)/);
  assert.match(source, /if \(next === 'published-asc' \|\| next === 'published-desc'\)/);
  assert.doesNotMatch(source, /if \(next !== 'default'\)/);
  assert.match(source, /showPublicationDates\(\)/);
  assert.match(source, /dateOverlay\.render\(nativeGrid, activeDates\)/);
  assert.match(source, /dateOverlay\.clear\(nativeGrid\)/);
  assert.match(css, /\.wl-sorter-published/);
  assert.match(css, /bottom: 7\.6px !important/);
  assert.match(css, /padding: 0 3px/);
  assert.match(css, /font: 12px\/16px/);
  assert.doesNotMatch(css, /bottom: 7\.7px !important/);
  assert.doesNotMatch(css, /bottom: 7\.5px !important/);
  assert.doesNotMatch(css, /bottom: 7px !important/);
  assert.doesNotMatch(css, /bottom: 8px !important/);
  assert.doesNotMatch(css, /bottom: 6px !important/);
  assert.doesNotMatch(css, /bottom: 23px/);
  assert.match(css, /background: rgba\(0, 0, 0, 0\.50\)/);
  assert.doesNotMatch(css, /background: rgba\(0, 0, 0, 0\.74\)/);
  assert.match(css, /pointer-events: none/);
  assert.match(css, /position: absolute/);
  assert.doesNotMatch(source, /createElement\('article'\)/);
});


test('publication labels inherit native video progress/time typography where available', () => {
  const overlay = read('src/date-overlay.js');
  assert.match(overlay, /function findNativeTime\(container\)/);
  assert.match(overlay, /function matchNativeTimeFont\(card, host, badge\)/);
  assert.match(overlay, /badge\.style\.fontSize = font\.fontSize/);
  assert.match(overlay, /matchNativeTimeFont\(card, host, badge\)/);
  assert.doesNotMatch(read('src/content.css'), /font:\s*11px\/16px/);
});

test('each requested sort fetches fresh metadata, skipping document_start preload', () => {
  const source = read('src/content.js');
  assert.match(source, /const items = await fullData\(true\)/);
  assert.match(source, /return fetchFullData\(false\)\.then/);
  assert.match(source, /if \(allowEarly\)/);
  assert.match(source, /if \(epoch === cacheEpoch\) cached = items/);
});
