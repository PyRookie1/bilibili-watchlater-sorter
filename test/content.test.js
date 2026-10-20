const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(base, name), 'utf8');

test('manifest injects page bridge, native sorter and event handler', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.version, '0.5.1');
  const page = manifest.content_scripts.find(x => x.world === 'MAIN');
  const isolated = manifest.content_scripts.find(x => x.world !== 'MAIN');
  assert.equal(page.run_at, 'document_start');
  assert.ok(page.js.includes('src/native-intercept.js'));
  assert.ok(page.js.includes('src/page-bridge.js'));
  assert.deepEqual(isolated.js, ['src/sort.js', 'src/native-sort.js', 'src/content.js']);
});

test('sort click obtains metadata even if Bilibili does not use intercepted API', () => {
  const script = read('src/content.js');
  assert.match(script, /select\.addEventListener\('change'/);
  assert.match(script, /await ensureMetadata\(\)/);
  assert.match(script, /chrome\.runtime\.sendMessage\(\{ type: 'WL_SORTER_FETCH'/);
  assert.match(script, /sendToPage\('GET_SNAPSHOT'/);
  assert.match(script, /sendToPage\('REQUEST'/);
  assert.match(script, /sendToPage\('SET_MODE'/);
  assert.match(script, /sortVisibleCards\(\)/);
  assert.match(script, /report\('排序失败：'/);
});

test('page fallback request IDs satisfy UUID validation in main-world handler', () => {
  const content = read('src/content.js');
  const bridge = read('src/page-bridge.js');
  assert.match(content, /const id = crypto\.randomUUID\(\)/);
  assert.match(bridge, /\[a-f0-9-\]\{16,64\}/);
  assert.doesNotMatch(content, /'wl-'\s*\+\s*\(\+\+bridgeSerial\)/);
});

test('native progressive ordering does not require all 423 DOM cards', () => {
  const content = read('src/content.js');
  const matcher = read('src/native-sort.js');
  assert.doesNotMatch(content, /entries\.length !== videos\.length/);
  assert.match(content, /if \(!mapping\.usable\) return/);
  assert.match(content, /style\.setProperty\('order', String\(item\.order\), 'important'\)/);
  assert.match(matcher, /usable: matched > 0 && used\.size === matched/);
  assert.match(content, /schedule\(\)/);
});

test('no forced reload, automatic scroll, or extension view', () => {
  for (const name of ['src/content.js', 'src/native-intercept.js']) {
    const code = read(name);
    assert.doesNotMatch(code, /\.scrollTop\s*=|scrollIntoView|window\.scrollTo|location\.reload\(/);
    assert.doesNotMatch(code, /materializeNativeCards|createElement\('article'\)|wl-sorter-full-list/);
  }
  assert.doesNotMatch(read('src/content.css'), /wl-sorter-full-list|wl-sorter-refresh/);
});

test('sorting failure is visible instead of an ignored return', () => {
  const content = read('src/content.js');
  assert.match(content, /无法匹配原生视频卡片；当前页面排序未生效/);
  assert.match(content, /status\.textContent = message/);
  assert.match(content, /sortVisibleCards\(\)/);
});
