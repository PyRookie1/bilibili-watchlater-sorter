/* Experiment D: virtual, read-only watch-later view. No Pinia mutation. */
(function (root) {
  'use strict';
  const SORT = root.WatchLaterSort;
  const ROW_HEIGHT = 112;
  let active = null;
  function visibleRange(top, height, count) {
    const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - 5);
    return {
      first,
      last: Math.min(count, first + Math.ceil(height / ROW_HEIGHT) + 11)
    };
  }
  function clear(grid) {
    if (!active || (grid && active.grid !== grid)) return;
    active.host.remove();
    active.grid.style.display = active.display;
    active = null;
  }
  function css(node, text) { node.style.cssText = text; return node; }
  function textNode(tag, value) {
    const node = document.createElement(tag);
    node.textContent = value;
    return node;
  }
  function show(grid, items, mode) {
    if (!grid || !Array.isArray(items)) throw new Error('虚拟列表缺少原生容器或数据');
    clear();
    const ordered = SORT.sortVideos(items, mode);
    const host = css(document.createElement('section'),
      'background:#18191c;color:#e3e5e7;border-radius:8px;padding:14px;margin:10px 0;font-size:14px;');
    host.className = 'wl-sorter-virtual-host';
    const header = textNode('div', '虚拟排序 · ' + ordered.length + ' 条 · 仅浏览（不提供删除、勾选）');
    css(header, 'font-weight:600;padding-bottom:12px;');
    host.append(header);
    const viewport = css(document.createElement('div'),
      'height:min(68vh,700px);min-height:320px;overflow-y:auto;position:relative;overscroll-behavior:contain;');
    viewport.setAttribute('role', 'list');
    viewport.setAttribute('aria-label', '排序后的稍后再看视频');
    const canvas = css(document.createElement('div'),
      'height:' + (ordered.length * ROW_HEIGHT) + 'px;position:relative;');
    viewport.append(canvas); host.append(viewport);
    grid.parentNode.insertBefore(host, grid);
    const display = grid.style.display;
    grid.style.display = 'none';
    active = { grid, host, display };
    const draw = () => {
      if (active?.host !== host) return;
      const { first, last } = visibleRange(viewport.scrollTop, viewport.clientHeight || 600, ordered.length);
      const fragment = document.createDocumentFragment();
      for (let i = first; i < last; i++) {
        const item = ordered[i];
        const link = css(document.createElement('a'),
          'position:absolute;left:0;right:0;top:' + (i * ROW_HEIGHT) + 'px;' +
          'height:102px;display:flex;gap:12px;padding:7px;box-sizing:border-box;' +
          'border-bottom:1px solid #38383d;text-decoration:none;color:inherit;align-items:center;');
        link.href = SORT.videoLink(item) || '#';
        if (link.getAttribute('href') === '#') link.addEventListener('click', event => event.preventDefault());
        const cover = SORT.coverLink(item.pic);
        if (cover) {
          const img = document.createElement('img');
          img.src = cover;
          img.alt = '';
          img.loading = 'lazy';
          css(img, 'width:144px;height:82px;object-fit:cover;border-radius:5px;flex-shrink:0;');
          link.append(img);
        }
        const detail = css(document.createElement('div'), 'min-width:0;flex:1;');
        const title = textNode('div', item.title || '无标题视频');
        css(title, 'font-size:14px;line-height:22px;max-height:44px;overflow:hidden;');
        const meta = textNode('div', (item.owner || '未知UP主') + ' · ' +
          SORT.formatDuration(item.duration) +
          (mode.startsWith('published-') ? ' · ' + SORT.formatPublished(item.pubdate) : ''));
        css(meta, 'font-size:12px;color:#9499a0;margin-top:9px;');
        detail.append(title, meta);link.append(detail);fragment.append(link);
      }
      canvas.replaceChildren(fragment);
    };
    viewport.addEventListener('scroll', draw, { passive: true });
    draw();
    console.info('[稍后再看排序/D] 虚拟列表已展示', {
      total: ordered.length, domRows: canvas.childElementCount
    });
    return { count: ordered.length, visible: canvas.childElementCount };
  }
  root.WatchLaterVirtual = Object.freeze({ show, clear, visibleRange });
  if (typeof module !== 'undefined' && module.exports)
    module.exports = root.WatchLaterVirtual;
})(typeof globalThis !== 'undefined' ? globalThis : this);
