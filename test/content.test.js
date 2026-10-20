const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(base, name), 'utf8');

test('interceptor executes at document_start before Bilibili app requests data', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.equal(m.version, '0.5.0');
  assert.deepEqual(m.permissions, ['storage']);
  const main = m.content_scripts.find(script => script.world === 'MAIN');
  assert.equal(main.run_at, 'document_start');
  assert.deepEqual(main.js, [
    'src/sort.js', 'src/native-intercept.js', 'src/api.js', 'src/page-bridge.js'
  ]);
  const isolated = m.content_scripts.find(script => script.world !== 'MAIN');
  assert.deepEqual(isolated.js, ['src/sort.js', 'src/native-sort.js', 'src/content.js']);
  for (const rule of m.content_scripts) {
    assert.ok(rule.matches.includes('https://www.bilibili.com/watchlater*'));
    assert.ok(rule.matches.includes('https://www.bilibili.com/list/watchlater*'));
    for (const path of [...(rule.js || []), ...(rule.css || [])]) {
      assert.ok(fs.existsSync(require('node:path').join(base, path)), path);
    }
  }
});

test('no auto-scroll, polling loader or replacement video view exists', () => {
  const content = read('src/content.js');
  const intercept = read('src/native-intercept.js');
  const css = read('src/content.css');
  for (const source of [content, intercept]) {
    assert.doesNotMatch(source, /\.scrollTop\s*=/);
    assert.doesNotMatch(source, /scrollIntoView/);
    assert.doesNotMatch(source, /materializeNativeCards/);
    assert.doesNotMatch(source, /window\.scrollTo\(/);
    assert.doesNotMatch(source, /createElement\('article'\)/);
  }
  assert.doesNotMatch(content, /wl-sorter-refresh|wl-sorter-status|refresh\.disabled|progress/);
  assert.doesNotMatch(content, /fullGrid|renderCard\(|replaceChildren\(/);
  assert.doesNotMatch(css, /wl-sorter-full-list|wl-sorter-refresh|wl-sorter-status/);
});

test('native sort stays in original page and only rearranges complete rendered list', () => {
  const content = read('src/content.js');
  assert.match(content, /watchlater-list-container/);
  assert.match(content, /querySelectorAll\('\.video-card'\)/);
  assert.match(content, /entries\.length !== videos\.length/);
  assert.match(content, /matchNativeEntries/);
  assert.match(content, /native.*sort/i);
  assert.match(content, /resetInlineOrders/);
  assert.match(content, /type: 'SET_MODE'/);
  assert.match(content, /reactiveApplied/);
  assert.doesNotMatch(content, /auto.*loading/i);
});
