'use strict';
importScripts('api.js');

function validSender(sender) {
  if (sender?.id !== chrome.runtime.id || typeof sender.url !== 'string') return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'https:' && url.hostname === 'www.bilibili.com' &&
      (/^\/watchlater(?:\/|$)/.test(url.pathname) || /^\/list\/watchlater(?:\/|$)/.test(url.pathname));
  } catch { return false; }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'WL_SORTER_FETCH' || !validSender(sender)) return false;
  const expectedCount = Number.isSafeInteger(message.expectedCount) && message.expectedCount >= 0
    ? message.expectedCount : undefined;
  WatchLaterApi.fetchCompleteList(fetch, { expectedCount }).then(sendResponse).catch(error => sendResponse({
    ok: false, error: error instanceof Error ? error.message : '无法读取完整稍后再看列表'
  }));
  return true;
});

chrome.action.onClicked.addListener(tab => {
  if (typeof tab?.url === 'string' &&
      /^https:\/\/www\.bilibili\.com\/(?:watchlater|list\/watchlater)(?:\/|\?|#|$)/.test(tab.url)) {
    chrome.tabs.sendMessage(tab.id, { type: 'WL_SORTER_OPEN' }).catch(() => {
      chrome.tabs.create({ url: 'https://www.bilibili.com/watchlater/list#/list' });
    });
  } else {
    chrome.tabs.create({ url: 'https://www.bilibili.com/watchlater/list#/list' });
  }
});
