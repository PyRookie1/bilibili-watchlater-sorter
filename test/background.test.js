const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../src/background.js'),'utf8');
function harness(body, status=200) {
  let listener;
  const calls = [];
  const chrome = {
    runtime:{id:'extension-test-id',onMessage:{addListener(fn){listener=fn;}}},
    action:{onClicked:{addListener(){}}},
    tabs:{sendMessage(){},create(){}}
  };
  const fetch = async (url,options) => {
    calls.push({url,options});
    return {ok:status>=200&&status<300,status,async json(){return body;}};
  };
  vm.runInNewContext(source,{chrome,fetch,URL,AbortController,setTimeout,clearTimeout});
  const sender = {id:chrome.runtime.id,url:'https://www.bilibili.com/list/watchlater'};
  const request = (from=sender) => new Promise((resolve,reject) => {
    try {
      const reply = listener({type:'WL_SORTER_FETCH'},from,resolve);
      if (reply===false) resolve('rejected');
    } catch(e) {reject(e);}
  });
  return {request,calls};
}
test('fetches login-based watch later list, returns only expected fields',async()=>{
  const {request,calls}=harness({code:0,data:{count:1,list:[{
    bvid:'BV1AB411c7mD',title:'Demo',duration:123,pubdate:1000,
    owner:{name:'Uploader'},confidential:'do-not-forward'
  }]}});
  const output=await request();
  assert.equal(output.ok,true);
  assert.equal(output.count,1);
  assert.equal(output.items[0].owner,'Uploader');
  assert.equal(Object.hasOwn(output.items[0],'confidential'),false);
  assert.equal(calls[0].url,'https://api.bilibili.com/x/v2/history/toview');
  assert.equal(calls[0].options.credentials,'include');
});
test('rejects requests from other pages and extensions',async()=>{
  const {request,calls}=harness({code:0,data:{count:0,list:[]}});
  for(const from of [
    {id:'other',url:'https://www.bilibili.com/list/watchlater'},
    {id:'extension-test-id',url:'https://evil.example/watchlater'},
    {id:'extension-test-id',url:'https://www.bilibili.com/video/BV1AB411c7mD'},
    {id:'extension-test-id',url:'https://www.bilibili.com/watchlater-evil'}
  ]) assert.equal(await request(from),'rejected');
  assert.equal(calls.length,0);
});
test('returns errors for invalid login, malformed response, HTTP failure',async()=>{
  assert.match((await harness({code:-101}).request()).error,/登录状态/);
  assert.match((await harness({code:0,data:{list:null}}).request()).error,/格式/);
  assert.match((await harness({},412).request()).error,/412/);
});
test('also accepts legacy watch later URL',async()=>{
  const {request}=harness({code:0,data:{count:0,list:[]}});
  const result=await request({id:'extension-test-id',url:'https://www.bilibili.com/watchlater/list/'});
  assert.equal(result.ok,true);
});
