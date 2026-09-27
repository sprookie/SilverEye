/* ==========================================================================
   gallery.js —— 胶卷条 / 灯箱 / 对比视图
   ========================================================================== */
window.GALLERY = (function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let shots = [];
  let onRedo = null, onLoad = null, onDelete = null;
  let lbCurrent = null;
  let onRender = null;      // 渲染完成回调（app.js 用它给新帧挂选择拦截器）

  function setHandlers(h) { onRedo = h.redo; onLoad = h.load; onDelete = h.del; }
  function setRenderHook(fn) { onRender = fn; }

  function replaceAll(items) {
    shots = items.slice();
    renderStrip();
  }

  function add(item, animate) {
    shots.unshift(item);
    renderStrip(animate ? item.id : null);
  }

  function remove(id) {
    shots = shots.filter((s) => s.id !== id);
    if (lbCurrent && lbCurrent.id === id) closeLightbox();
    renderStrip();
  }

  function list() { return shots; }
  function get(id) { return shots.find((s) => s.id === id); }

  /* ------------------------------------------------------------ 胶卷条 */
  function renderStrip(newId) {
    const el = $('filmstrip');
    if (!shots.length) {
      el.innerHTML = '<div class="frame skeleton"><div class="sp"></div></div>';
      $('stripInfo').textContent = '还没有照片 —— 按快门开始';
      return;
    }
    $('stripInfo').textContent = `${shots.length} 张 · 点击查看 EXIF 与提示词`;
    el.innerHTML = shots.map((s, i) => {
      const n = String(shots.length - i).padStart(2, '0');
      const m = s.meta || {};
      const bw = m.bw ? ' bw' : '';
      return `<div class="frame${s.id === newId ? ' new' : ''}" data-id="${s.id}" data-i="${i}">
        <img src="${s.url}" loading="lazy" alt="" />
        <span class="badge${bw}">${m.bw ? 'B&W' : (m.filmShort || 'IMG')}</span>
        <div class="fr-meta">
          <span class="n">${n}</span>
          <span>${m.aperture || ''}</span>
          <span class="sp"></span>
          <span>${m.shutter || ''}</span>
        </div>
      </div>`;
    }).join('');
    el.querySelectorAll('.frame').forEach((f) => {
      f.addEventListener('click', () => openLightbox(f.dataset.id));
    });
    if (typeof onRender === 'function') onRender();
  }

  /* ------------------------------------------------------------ 灯箱 */
  function openLightbox(id) {
    const s = get(id);
    if (!s) return;
    lbCurrent = s;
    $('lbImg').src = s.url;
    const m = s.meta || {};
    const rows = [
      ['场景', m.sceneCn || '—'],
      ['机身', m.bodyCn || '—'],
      ['焦距', m.focal ? m.focal + 'mm（等效 ' + m.equiv + 'mm）' : '—'],
      ['光圈', m.aperture || '—'],
      ['快门', m.shutter || '—'],
      ['ISO', m.iso || '—'],
      ['胶片', m.filmCn || '—'],
      ['手法', m.techCn || '常规'],
      ['构图', m.compCn || '—'],
      ['距离', m.dist || '—'],
      ['视角', m.fov || '—'],
      ['景深', m.dof || '—'],
      ['测光', m.meter || '—'],
      ['种子', String(s.seed)],
      ['耗时', s.elapsed + 's']
    ];
    $('lbExif').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    $('lbPrompt').textContent = s.prompt || '';
    $('lbNeg').textContent = s.negative_prompt || '（无）';
    $('lightbox').classList.add('on');
  }

  function closeLightbox() { $('lightbox').classList.remove('on'); lbCurrent = null; }

  /* ------------------------------------------------------------ 对比视图 */
  function renderCompare(dim, a, b, diffA, diffB) {
    $('cmpA_hd').textContent = a.head;
    $('cmpA_sub').textContent = a.sub || '';
    $('cmpA_img').src = a.url;
    $('cmpA_diff').innerHTML = diffA || '';
    $('cmpB_hd').textContent = b.head;
    $('cmpB_sub').textContent = b.sub || '';
    $('cmpB_img').src = b.url;
    $('cmpB_diff').innerHTML = diffB || '';
    $('compare').classList.add('on');
  }

  function compareLoading(aHead, bHead) {
    $('cmpA_hd').textContent = aHead;
    $('cmpB_hd').textContent = bHead;
    $('cmpA_img').removeAttribute('src');
    $('cmpB_img').removeAttribute('src');
    $('cmpA_diff').textContent = '显影中…';
    $('cmpB_diff').textContent = '显影中…';
    $('compare').classList.add('on');
  }

  /* ------------------------------------------------------------ 绑定 */
  function bind() {
    $('lbClose').addEventListener('click', closeLightbox);
    $('lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });
    $('lbRedo').addEventListener('click', () => { if (lbCurrent && onRedo) onRedo(lbCurrent); });
    $('lbLoad').addEventListener('click', () => { if (lbCurrent && onLoad) onLoad(lbCurrent); });
    $('lbDel').addEventListener('click', async () => {
      if (!lbCurrent || !onDelete) return;
      await onDelete(lbCurrent);
    });
  }

  return { replaceAll, add, remove, list, get, renderStrip, openLightbox, closeLightbox,
           renderCompare, compareLoading, bind, setHandlers, setRenderHook };
})();
