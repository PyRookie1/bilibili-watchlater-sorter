const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/page-bridge.js'), 'utf8');
const uuid = '123e4567-e89b-12d3-a456-426614174000';
const channel = 'wl-sorter-bilibili-v1';

function initialize() {
  const handlers = [];
  const posted = [];
  const win = {
    addEventListener(type, handler) { if (type === 'message') handlers.push(handler); },
    postMessage(message, origin) { posted.push({message, origin}); }
  };
  const calls = [];
  const api = {
    async fetchCompleteList(fetcher, options) {
      calls.push(options);
      return { ok:true, count:2, items:[{bvid:'BV1AB411c7mD'},{bvid:'BV2AB411c7mD'}] };
    }
  };
  const scope = {
    window: win,
    location: { origin: 'https://www.bilibili.com' },
    globalThis: { WatchLaterApi: api },
    fetch() {}
  };
  vm.runInNewContext(source, scope);
  return {handlers, posted, calls, win};
}

test('valid UUID bridge request returns complete API payload', async () => {
  const {handlers,posted,calls,win} = initialize();
  await handlers[0]({
    source:win,origin:'https://www.bilibili.com',
    data: { channel, type:'REQUEST', id:uuid, expectedCount:2 }
  });
  assert.equal(posted.length,1);
  assert.equal(posted[0].message.id,uuid);
  assert.equal(posted[0].message.type,'RESPONSE');
  assert.equal(posted[0].message.payload.items.length,2);
  assert.equal(calls[0].expectedCount,2);
});

test('bridge rejects malformed IDs, incorrect origins and non-request messages', async () => {
  const {handlers,posted,win} = initialize();
  for (const event of [
    { source:win,origin:'https://www.bilibili.com',data:{channel,type:'REQUEST',id:'wl-1-'+uuid} },
    { source:win,origin:'https://evil.example',data:{channel,type:'REQUEST',id:uuid} },
    { source:win,origin:'https://www.bilibili.com',data:{channel,type:'SET_MODE',id:uuid} }
  ]) await handlers[0](event);
  assert.equal(posted.length,0);
});
