/* Watch-later API adapter shared by extension service worker and page context. */
(function (root) {
  'use strict';
  const ENDPOINTS = Object.freeze([
    'https://api.bilibili.com/x/v2/history/toview',
    'https://api.bilibili.com/x/v2/history/toview/web?jsonp=jsonp'
  ]);
  function parseCompleteResponse(body) {
    if (body?.code === -101) throw new Error('未登录 B 站，请登录后刷新');
    if (body?.code !== 0) throw new Error('B 站 API 错误 ' + (body?.code ?? '未知') + '：' + (body?.message || '请求失败'));
    const data = body?.data;
    if (!Array.isArray(data?.list)) throw new Error('B 站 API 没有返回列表');
    const count = data.count;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('B 站 API 未返回有效总数，无法确认全量');
    if (data.list.length !== count) {
      throw new Error('接口数据不完整：返回 ' + data.list.length + ' / ' + count + ' 条');
    }
    const items = data.list.map((video, i) => {
      if (!video || typeof video !== 'object' || Array.isArray(video))
        throw new Error('第 ' + (i + 1) + ' 条视频数据无效');
      return {
        aid: video.aid, bvid: video.bvid,
        title: typeof video.title === 'string' ? video.title : '',
        pic: video.pic, pubdate: video.pubdate, duration: video.duration,
        add_at: video.add_at, progress: video.progress,
        owner: typeof video.owner?.name === 'string' ? video.owner.name : ''
      };
    });
    return { ok: true, count, items };
  }
  async function fetchCompleteList(fetcher, options = {}) {
    const timeoutMs = options.timeoutMs ?? 15000;
    const errors = [];
    for (const url of ENDPOINTS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(url, {
          method: 'GET', credentials: 'include', cache: 'no-store',
          headers: { Accept: 'application/json' }, signal: controller.signal
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const result = parseCompleteResponse(await response.json());
        if (Number.isSafeInteger(options.expectedCount) && options.expectedCount >= 0 &&
            result.count !== options.expectedCount) {
          throw new Error('页面显示 ' + options.expectedCount + ' 条，但接口只返回 ' + result.count + ' 条');
        }
        return { ...result, endpoint: url };
      } catch (error) {
        errors.push(url.includes('/web') ? '网页接口：' + (error.message || String(error)) :
          '常规接口：' + (error.message || String(error)));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error('无法读取完整稍后再看列表。' + errors.join('；'));
  }
  const exported = Object.freeze({ ENDPOINTS, parseCompleteResponse, fetchCompleteList });
  root.WatchLaterApi = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);
