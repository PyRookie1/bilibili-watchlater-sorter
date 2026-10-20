(() => {
  'use strict';
  if (document.getElementById('wl-sorter-root')) return;
  const {sortVideos, isSortMode, formatDuration, formatPublished, videoLink, coverLink} = globalThis.WatchLaterSort;
  const CHANNEL = 'wl-sorter-bilibili-v1', STORAGE_KEY = 'wl-sorter-mode';
  let mode = 'default', videos = null, count = 0, busy = false, returnFocus;
  const root = document.createElement('div');
  root.id = 'wl-sorter-root';
  root.innerHTML = `
    <button type="button" class="wl-sorter-launcher">稍后再看排序</button>
    <div class="wl-sorter-overlay" hidden>
      <div class="wl-sorter-backdrop"></div>
      <section class="wl-sorter-dialog" role="dialog" aria-modal="true" aria-labelledby="wl-sorter-title">
        <header class="wl-sorter-head">
          <div><h2 id="wl-sorter-title">稍后再看 · 排序</h2><p>按发布时间或视频总时长浏览列表</p></div>
          <button type="button" class="wl-sorter-close" aria-label="关闭排序面板">×</button>
        </header>
        <div class="wl-sorter-tools">
          <label>排序方式 <select class="wl-sorter-select">
            <option value="default">默认顺序</option>
            <option value="published-desc">发布时间：最新优先</option>
            <option value="published-asc">发布时间：最早优先</option>
            <option value="duration-asc">总时长：短到长</option>
            <option value="duration-desc">总时长：长到短</option>
          </select></label>
          <button type="button" class="wl-sorter-refresh">刷新列表</button>
        </div>
        <div class="wl-sorter-summary" role="status" aria-live="polite"></div>
        <div class="wl-sorter-list" aria-label="排序后的视频列表"></div>
        <footer class="wl-sorter-footer">仅调整本面板中的显示顺序，不改变服务器列表或自动连播顺序。</footer>
      </section>
    </div>`;
  const $ = s => root.querySelector(s);
  const launch = $('.wl-sorter-launcher'), overlay = $('.wl-sorter-overlay');
  const select = $('.wl-sorter-select'), list = $('.wl-sorter-list'), summary = $('.wl-sorter-summary');
  const refresh = $('.wl-sorter-refresh'), closeButton = $('.wl-sorter-close');
  function makeEl(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = String(text);
    return el;
  }
  function setSummary(message, kind = 'normal') {
    summary.textContent = message; summary.dataset.kind = kind;
  }
  function renderCard(video) {
    const card = makeEl('article', 'wl-sorter-card');
    const cover = makeEl('div', 'wl-sorter-cover');
    const image = coverLink(video.pic);
    if (image) {
      const img = document.createElement('img'); img.src = image; img.alt = '';
      img.loading = 'lazy'; img.decoding = 'async'; cover.append(img);
    } else cover.append(makeEl('span', 'wl-sorter-placeholder', '暂无封面'));
    cover.append(makeEl('span', 'wl-sorter-duration', formatDuration(video.duration)));
    const info = makeEl('div', 'wl-sorter-info'), url = videoLink(video);
    const titleText = typeof video.title === 'string' && video.title.trim() ? video.title : '视频不可用或标题缺失';
    const title = makeEl(url ? 'a' : 'span', 'wl-sorter-title', titleText);
    if (url) { title.href = url; title.title = titleText; }
    const meta = makeEl('div', 'wl-sorter-meta');
    meta.append(makeEl('span', '', `发布：${formatPublished(video.pubdate)}`));
    meta.append(makeEl('span', '', `总时长：${formatDuration(video.duration)}`));
    if (typeof video.owner === 'string' && video.owner.trim())
      meta.append(makeEl('span', '', `UP：${video.owner}`));
    info.append(title, meta); card.append(cover, info); return card;
  }
  function render() {
    list.replaceChildren();
    if (!Array.isArray(videos)) return;
    const sorted = sortVideos(videos, mode);
    if (!sorted.length) list.append(makeEl('p', 'wl-sorter-empty', '稍后再看列表为空。'));
    else {
      const fragment = document.createDocumentFragment();
      for (const video of sorted) fragment.append(renderCard(video));
      list.append(fragment);
    }
    const warning = count !== videos.length ? `（接口声明 ${count} 项，实际返回 ${videos.length} 项，可能不完整）` : '';
    setSummary(`已加载 ${videos.length} 个视频 ${warning}`.trim());
  }
  function fetchFromPage() {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      let finished = false;
      const timer = setTimeout(() => finish(new Error('页面请求超时')), 17000);
      function finish(error, result) {
        if (finished) return;
        finished = true; clearTimeout(timer); window.removeEventListener('message', onMessage);
        if (error) reject(error); else resolve(result);
      }
      function onMessage(event) {
        if (event.source !== window || event.origin !== location.origin) return;
        const data = event.data;
        if (data?.channel === CHANNEL && data.type === 'RESPONSE' && data.id === id)
          finish(null, data.payload);
      }
      window.addEventListener('message', onMessage);
      window.postMessage({channel: CHANNEL, type: 'REQUEST', id}, location.origin);
    });
  }
  async function fetchList() {
    let firstError = '扩展后台请求失败';
    try {
      const result = await chrome.runtime.sendMessage({type: 'WL_SORTER_FETCH'});
      if (result?.ok && Array.isArray(result.items)) return result;
      firstError = result?.error || firstError;
    } catch (error) { firstError = error instanceof Error ? error.message : firstError; }
    try {
      const result = await fetchFromPage();
      if (result?.ok && Array.isArray(result.items)) return result;
      throw new Error(result?.error || '页面上下文读取失败');
    } catch (error) {
      throw new Error(`${firstError}；页面请求：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }
  async function reload() {
    if (busy) return;
    busy = true; refresh.disabled = true; refresh.textContent = '加载中…';
    setSummary('正在读取稍后再看列表…');
    try {
      const result = await fetchList();
      videos = result.items;
      count = Number.isFinite(result.count) ? result.count : videos.length;
      render();
    } catch (error) {
      setSummary(`加载失败：${error instanceof Error ? error.message : '未知错误'}。请确认已登录 B 站。`, 'error');
      if (!videos) list.replaceChildren(makeEl('p', 'wl-sorter-empty', '无法读取列表，请检查登录状态、网络连接及扩展权限。'));
    } finally {
      busy = false; refresh.disabled = false; refresh.textContent = '刷新列表';
    }
  }
  function open() {
    if (!overlay.hidden) return;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : launch;
    overlay.hidden = false; select.value = mode; closeButton.focus();
    if (videos === null) void reload(); else render();
  }
  function close() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    if (returnFocus?.isConnected) returnFocus.focus(); else launch.focus();
  }
  launch.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  $('.wl-sorter-backdrop').addEventListener('click', close);
  refresh.addEventListener('click', () => void reload());
  select.addEventListener('change', () => {
    mode = isSortMode(select.value) ? select.value : 'default';
    chrome.storage.local.set({[STORAGE_KEY]: mode}).catch(() => {});
    render();
  });
  document.addEventListener('keydown', event => {
    if (overlay.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key !== 'Tab') return;
    const active = [...overlay.querySelectorAll('button:not(:disabled), select, a[href]')].filter(el => el.getClientRects().length > 0);
    if (!active.length) return;
    const first = active[0], last = active[active.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  chrome.runtime.onMessage.addListener(message => { if (message?.type === 'WL_SORTER_OPEN') open(); });
  document.documentElement.append(root);
  chrome.storage.local.get(STORAGE_KEY).then(saved => {
    if (isSortMode(saved?.[STORAGE_KEY])) mode = saved[STORAGE_KEY];
    select.value = mode;
  }).catch(() => {});
})();
