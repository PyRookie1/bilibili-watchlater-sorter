'use strict';
const API_URL = 'https://api.bilibili.com/x/v2/history/toview';
function validSender(sender) {
  if (sender?.id !== chrome.runtime.id || typeof sender.url !== 'string') return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'https:' && url.hostname === 'www.bilibili.com' &&
      (/^\/watchlater(?:\/|$)/.test(url.pathname) || /^\/list\/watchlater(?:\/|$)/.test(url.pathname));
  } catch { return false; }
}
async function fetchVideos() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(API_URL, { method: 'GET', credentials: 'include', cache: 'no-store',
      headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(`B站接口返回 HTTP ${response.status}`);
    const body = await response.json();
    if (body?.code === -101) throw new Error('B站登录状态不可用，请登录后刷新页面');
    if (body?.code !== 0) throw new Error(`B站接口错误 ${body?.code ?? '未知'}：${body?.message || '请求失败'}`);
    if (!Array.isArray(body?.data?.list)) throw new Error('接口返回的数据格式发生变化');
    return {
      ok: true, count: Number.isFinite(body.data.count) ? body.data.count : body.data.list.length,
      items: body.data.list.filter(item => item && typeof item === 'object').map(item => ({
        aid: item.aid, bvid: item.bvid, title: item.title, pic: item.pic,
        pubdate: item.pubdate, duration: item.duration, add_at: item.add_at,
        owner: typeof item.owner?.name === 'string' ? item.owner.name : ''
      }))
    };
  } finally { clearTimeout(timer); }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'WL_SORTER_FETCH' || !validSender(sender)) return false;
  fetchVideos().then(sendResponse).catch(error => sendResponse({
    ok: false, error: error instanceof Error ? error.message : '无法读取稍后再看列表'
  }));
  return true;
});
chrome.action.onClicked.addListener(tab => {
  if (typeof tab?.url === 'string' &&
      /^https:\/\/www\.bilibili\.com\/(?:watchlater|list\/watchlater)(?:\/|\?|#|$)/.test(tab.url)) {
    chrome.tabs.sendMessage(tab.id, { type: 'WL_SORTER_OPEN' }).catch(() => {
      chrome.tabs.create({ url: 'https://www.bilibili.com/list/watchlater' });
    });
  } else {
    chrome.tabs.create({ url: 'https://www.bilibili.com/list/watchlater' });
  }
});
