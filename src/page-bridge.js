/* Fallback: fetch list from Bilibili page context. Never read or transmit cookies. */
(() => {
  'use strict';
  const CHANNEL = 'wl-sorter-bilibili-v1';
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.channel !== CHANNEL || data.type !== 'REQUEST' ||
        typeof data.id !== 'string' || !/^[a-f0-9-]{16,64}$/.test(data.id)) return;
    let payload;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch('https://api.bilibili.com/x/v2/history/toview', {
          credentials: 'include', cache: 'no-store', signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        if (json?.code !== 0 || !Array.isArray(json?.data?.list))
          throw new Error(json?.code === -101 ? '登录状态不可用' : `接口错误 ${json?.code ?? '未知'}：${json?.message || '数据无效'}`);
        payload = {
          ok: true, count: json.data.count,
          items: json.data.list.filter(item => item && typeof item === 'object').map(item => ({
            aid: item.aid, bvid: item.bvid, title: item.title, pic: item.pic,
            pubdate: item.pubdate, duration: item.duration, add_at: item.add_at,
            owner: typeof item.owner?.name === 'string' ? item.owner.name : ''
          }))
        };
      } finally { clearTimeout(timer); }
    } catch (error) {
      payload = { ok: false, error: error instanceof Error ? error.message : '请求失败' };
    }
    window.postMessage({ channel: CHANNEL, type: 'RESPONSE', id: data.id, payload }, location.origin);
  });
})();
