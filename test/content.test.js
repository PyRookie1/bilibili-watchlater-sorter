const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(base, name), 'utf8');

test('v0.6.0 loads full native Pinia sorter before the page bridge', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.version, '0.6.0');
  const main = manifest.content_scripts.find(item => item.world === 'MAIN');
  const isolated = manifest.content_scripts.find(item => item.world !== 'MAIN');
  assert.equal(main.run_at, 'document_start');
  assert.deepEqual(main.js, [
    'src/sort.js', 'src/full-native.js', 'src/native-intercept.js',
    'src/api.js', 'src/page-bridge.js'
  ]);
  assert.deepEqual(isolated.js, ['src/sort.js', 'src/content.js']);
  for (const rule of manifest.content_scripts) {
    for (const script of rule.js)
      assert.ok(fs.existsSync(path.join(base, script)), script);
  }
});

test('no fake native-card sorting by CSS order, forced scroll or page reload', () => {
  const content = read('src/content.js');
  const native = read('src/full-native.js');
  const main = read('src/native-intercept.js');
  for (const code of [content, native, main]) {
    assert.doesNotMatch(code, /\.scrollTop\s*=|scrollIntoView|window\.scrollTo|location\.reload\(/);
    assert.doesNotMatch(code, /createElement\('article'\)|fullGrid|wl-sorter-full-list/);
    assert.doesNotMatch(code, /style\.setProperty\('order'|sortVisibleCards\(/);
  }
  assert.doesNotMatch(content, /querySelectorAll\('\.video-card'\)/);
});

test('select requires complete API data and confirms native state was fully sorted', () => {
  const content = read('src/content.js');
  assert.match(content, /select\.addEventListener\('change'/);
  assert.match(content, /chrome\.runtime\.sendMessage\(\{ type: 'WL_SORTER_FETCH' \}/);
  assert.match(content, /requestPage\('REQUEST'/);
  assert.match(content, /requestPage\('SET_MODE', \{ mode, items \}/);
  assert.match(content, /result\?\.ok/);
  assert.match(content, /全量排序失败：/);
  assert.match(content, /const id = crypto\.randomUUID\(\)/);
});

test('native loader is the only source of additional Bilibili card records', () => {
  const native = read('src/full-native.js');
  assert.match(native, /store\.loadMoreWatchlaterList\(\)/);
  assert.match(native, /watchlaterList\.splice\(0, state\.watchlaterList\.length, \.\.\.next\)/);
  assert.match(native, /getNativeItems\(store\)\.length/);
  assert.match(native, /原生列表只加载到/);
  assert.match(native, /原生视频与接口完整列表无法一一匹配/);
});
