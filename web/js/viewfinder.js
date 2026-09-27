/* ==========================================================================
   viewfinder.js —— 取景器的一切
   · 光圈叶片 SVG（按真实 f 值开合，叶片数随光圈变化）
   · 机身 SVG（不同结构画不同外形）
   · 取景器画面实时模拟：焦距缩放 / 景深模糊 / 曝光 / 颗粒 / 胶片色调
   · 快门帘、反光板、闪光、B 门倒计时
   ========================================================================== */
window.VF = (function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* 场景底图按 35mm 全画幅的取景范围打底 → 水平视角 54.5°，取景器缩放任据此换算 */
  const BASE_FOV = 2 * Math.atan(18 / 35) * 180 / Math.PI;
  const ZOOM_MAX = 6;          // 长焦裁切上限（再往上底图就糊了）

  const opts = { zebra: false };

  function setOptions(o) { Object.assign(opts, o || {}); }

  /* 各胶片的成像风格（取景器实时预览用） */
  const FILM_FILTER = {
    digital:      { s: 1.00, c: 1.00, b: 1.00, h: 0 },
    portra160:    { s: 0.88, c: 0.97, b: 1.04, h: -4 },
    portra400:    { s: 0.92, c: 0.98, b: 1.04, h: -5 },
    portra800:    { s: 0.90, c: 1.02, b: 1.05, h: -6 },
    ektar100:     { s: 1.32, c: 1.12, b: 1.00, h: 0 },
    gold200:      { s: 1.12, c: 1.06, b: 1.03, h: -10 },
    ultramax400:  { s: 1.22, c: 1.08, b: 1.00, h: -6 },
    e100:         { s: 1.08, c: 1.06, b: 1.00, h: 2 },
    velvia50:     { s: 1.48, c: 1.20, b: 0.98, h: 0 },
    provia100f:   { s: 1.10, c: 1.06, b: 1.00, h: 0 },
    astia:        { s: 0.86, c: 0.95, b: 1.05, h: -6 },
    pro400h:      { s: 0.95, c: 0.94, b: 1.06, h: 6 },
    superia400:   { s: 1.20, c: 1.08, b: 1.00, h: 8 },
    'cinestill800t': { s: 1.15, c: 1.10, b: 0.98, h: 10 },
    vision3:      { s: 1.05, c: 1.04, b: 1.01, h: -2 },
    sx70film:     { s: 0.70, c: 0.82, b: 1.10, h: 12 },
    polaroid600:  { s: 0.88, c: 0.96, b: 1.04, h: 16 },
    instaxfilm:   { s: 1.26, c: 1.10, b: 1.02, h: 10 }
  };

  /* ==================================================== 光圈叶片 */
  let irisT = 0;              // 0 = 全开, 1 = 收缩到底
  let irisRAF = 0;

  function polar(r, a, cx, cy) {
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }

  function bladePath(i, n, ri, R, ov, rot) {
    const h = Math.PI / n;
    const m = (i / n) * Math.PI * 2 + rot;
    const a1 = polar(ri, m - h, 50, 50);
    const a2 = polar(ri, m + h, 50, 50);
    const b1 = polar(R, m + h + ov, 50, 50);
    const b2 = polar(R, m - h + ov, 50, 50);
    // 稍微内凹，看起来像真实的刀片
    const mid = polar((ri + R) / 2, m + ov * 1.6, 50, 50);
    return `M${a1[0].toFixed(2)} ${a1[1].toFixed(2)}L${a2[0].toFixed(2)} ${a2[1].toFixed(2)}` +
           `L${b1[0].toFixed(2)} ${b1[1].toFixed(2)}Q${mid[0].toFixed(2)} ${mid[1].toFixed(2)} ` +
           `${b2[0].toFixed(2)} ${b2[1].toFixed(2)}Z`;
  }

  function renderIris(nBlades, t) {
    // t=0 全开 → ri 接近外缘；t=1 收缩 → ri 很小
    const R = 45;
    const ri = R * (0.90 - 0.80 * Math.pow(t, 0.82));
    const ov = 0.40 + 0.22 * t;
    const rot = -0.18 * t;
    let d = '';
    for (let i = 0; i < nBlades; i++) d += bladePath(i, nBlades, ri, R, ov, rot) + ' ';
    return d;
  }

  function buildIris(el) {
    el.innerHTML =
      '<svg viewBox="0 0 100 100">' +
      '<defs>' +
      '<radialGradient id="irisGlass" cx="46%" cy="38%">' +
      '<stop offset="0" stop-color="#5fa8bd"/><stop offset="0.45" stop-color="#245a6c"/>' +
      '<stop offset="1" stop-color="#0b1a21"/></radialGradient>' +
      '<radialGradient id="irisBladeG" cx="50%" cy="30%">' +
      '<stop offset="0" stop-color="#525c6d"/><stop offset="0.55" stop-color="#2b313d"/>' +
      '<stop offset="1" stop-color="#12151b"/></radialGradient>' +
      '</defs>' +
      '<circle cx="50" cy="50" r="47" fill="url(#irisGlass)"/>' +
      '<path id="irisBlades" fill="url(#irisBladeG)" stroke="#6a7486" stroke-width="0.6" ' +
      'stroke-linejoin="round"/>' +
      '<circle cx="50" cy="50" r="47" fill="none" stroke="#4a5262" stroke-width="2.6"/>' +
      '<circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="0.8"/>' +
      '<circle cx="44" cy="42" r="7" fill="#bfe4ee" opacity="0.16"/>' +
      '</svg>';
  }

  /** f 值 → 归一化的收缩量 t */
  function fToT(f) {
    // log2(f) 从 0 (f/1) 到 ~5 (f/32)
    return clamp(Math.log2(Math.max(1, f)) / Math.log2(32), 0, 1);
  }

  function setIris(f, blades) {
    const el = $('iris');
    if (!el) return;
    const p = el.querySelector('#irisBlades');
    if (!p) return;
    const target = fToT(f);
    const from = irisT;
    const t0 = performance.now();
    const dur = 620;
    cancelAnimationFrame(irisRAF);
    const step = (now) => {
      const k = clamp((now - t0) / dur, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      irisT = from + (target - from) * e;
      p.setAttribute('d', renderIris(blades || 9, irisT));
      if (k < 1) irisRAF = requestAnimationFrame(step);
    };
    irisRAF = requestAnimationFrame(step);
    const lb = $('irisLabel');
    if (lb) lb.textContent = 'f/' + window.ENGINE.fmtF(f);
  }

  /* ==================================================== 机身 SVG */
  function bodySVG(grip) {
    const S = (inner) => `<svg viewBox="0 0 132 88" fill="none">${inner}</svg>`;
    const body = 'fill="url(#mg)" stroke="#59616f" stroke-width="1"';
    const defs =
      '<defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#3a4150"/><stop offset="0.5" stop-color="#22262f"/>' +
      '<stop offset="1" stop-color="#151920"/></linearGradient>' +
      '<radialGradient id="lg" cx="38%" cy="32%"><stop offset="0" stop-color="#5b6577"/>' +
      '<stop offset="0.55" stop-color="#22262f"/><stop offset="1" stop-color="#0c0e13"/></radialGradient></defs>';
    const lens = (cx, cy, r) =>
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#lg)" stroke="#5a6373" stroke-width="1.2"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r * 0.66}" fill="#0a0c11" stroke="#3c434f" stroke-width="0.8"/>` +
      `<circle cx="${cx - r * 0.18}" cy="${cy - r * 0.22}" r="${r * 0.2}" fill="#7ea6c4" opacity="0.28"/>`;

    switch (grip) {
      case 'slr':
        return S(defs +
          `<rect x="10" y="16" width="112" height="60" rx="7" ${body}/>` +
          `<path d="M50 16 L54 5 L78 5 L82 16 Z" ${body}/>` +
          `<rect x="58" y="8" width="16" height="5" rx="1.5" fill="#4b5461"/>` +
          `<rect x="98" y="8" width="20" height="9" rx="3" ${body}/>` +
          lens(62, 46, 26) +
          `<rect x="14" y="22" width="12" height="48" rx="4" fill="#1b1f27" stroke="#4a5260" stroke-width="0.7"/>` +
          `<circle cx="20" cy="30" r="3" fill="#ffb43d" opacity="0.85"/>`);

      case 'mirrorless':
        return S(defs +
          `<rect x="10" y="14" width="112" height="62" rx="8" ${body}/>` +
          `<rect x="46" y="7" width="30" height="8" rx="3" ${body}/>` +
          `<rect x="98" y="7" width="20" height="8" rx="3" ${body}/>` +
          lens(62, 46, 28) +
          `<rect x="14" y="20" width="13" height="50" rx="5" fill="#1b1f27" stroke="#4a5260" stroke-width="0.7"/>` +
          `<circle cx="20.5" cy="28" r="3" fill="#ffb43d" opacity="0.85"/>`);

      case 'rangefinder':
        return S(defs +
          `<rect x="8" y="20" width="116" height="54" rx="5" ${body}/>` +
          `<rect x="20" y="18" width="26" height="5" rx="2" fill="#171a21" stroke="#4d5563" stroke-width="0.7"/>` +
          `<rect x="60" y="18" width="14" height="5" rx="1.5" fill="#171a21" stroke="#4d5563" stroke-width="0.7"/>` +
          lens(54, 48, 24) +
          `<circle cx="96" cy="30" r="4.5" fill="#0a0c11" stroke="#565e6d"/>` +
          `<circle cx="52" cy="27" r="2.6" fill="#ffb43d" opacity="0.8"/>`);

      case 'tlr':
        return S(defs +
          `<rect x="18" y="14" width="96" height="64" rx="6" ${body}/>` +
          lens(66, 38, 18) +
          lens(66, 68, 15) +
          `<rect x="24" y="20" width="10" height="52" rx="3" fill="#1b1f27" stroke="#4a5260" stroke-width="0.7"/>` +
          `<rect x="100" y="10" width="12" height="8" rx="2" fill="#22262f" stroke="#59616f" stroke-width="0.8"/>`);

      case 'view':
        return S(defs +
          `<rect x="6" y="22" width="120" height="12" rx="3" fill="#1d2129" stroke="#59616f" stroke-width="0.9"/>` +
          `<rect x="6" y="66" width="120" height="12" rx="3" fill="#1d2129" stroke="#59616f" stroke-width="0.9"/>` +
          `<path d="M34 34 l14 32 M92 34 l-14 32" stroke="#3b4250" stroke-width="1.6" stroke-dasharray="3 3"/>` +
          `<rect x="22" y="26" width="14" height="48" rx="2" fill="#2a303a" stroke="#5a6373" stroke-width="1"/>` +
          `<rect x="34" y="24" width="8" height="52" rx="2" fill="#22262f" stroke="#59616f" stroke-width="0.9"/>` +
          lens(104, 50, 17) +
          `<rect x="52" y="42" width="34" height="16" rx="2" fill="#0d1015" stroke="#454d5c" stroke-width="0.8"/>`);

      case 'compact':
        return S(defs +
          `<rect x="14" y="22" width="104" height="50" rx="9" ${body}/>` +
          `<rect x="24" y="18" width="52" height="6" rx="3" fill="#171a21" stroke="#4d5563" stroke-width="0.7"/>` +
          lens(56, 47, 19) +
          `<circle cx="102" cy="36" r="4" fill="#0a0c11" stroke="#565e6d"/>` +
          `<rect x="18" y="60" width="18" height="5" rx="2" fill="#1b1f27"/>`);

      case 'instant':
        return S(defs +
          `<rect x="10" y="14" width="112" height="64" rx="8" ${body}/>` +
          `<rect x="20" y="8" width="92" height="9" rx="3" fill="#171a21" stroke="#4d5563" stroke-width="0.8"/>` +
          `<circle cx="66" cy="48" r="22" fill="#0d1015" stroke="#5a6373" stroke-width="1.4"/>` +
          `<circle cx="66" cy="48" r="14" fill="#1a1e26" stroke="#3c434f" stroke-width="0.8"/>` +
          `<circle cx="60" cy="42" r="3" fill="#7ea6c4" opacity="0.3"/>` +
          `<rect x="98" y="24" width="14" height="9" rx="2" fill="#ff4d43" opacity="0.75"/>`);

      case 'phone':
        return S(defs +
          `<rect x="30" y="10" width="72" height="68" rx="11" fill="#1a1e26" stroke="#59616f" stroke-width="1.1"/>` +
          `<rect x="36" y="16" width="60" height="56" rx="7" fill="#0a0c11" stroke="#2c323d" stroke-width="0.7"/>` +
          `<rect x="40" y="20" width="22" height="18" rx="5" fill="#22262f" stroke="#4d5563" stroke-width="0.8"/>` +
          `<circle cx="48" cy="27" r="4.6" fill="#0d1015" stroke="#5a6373"/>` +
          `<circle cx="56" cy="33" r="3.6" fill="#0d1015" stroke="#5a6373"/>` +
          `<circle cx="46" cy="25.5" r="1.5" fill="#7ea6c4" opacity="0.45"/>`);

      case 'pinhole':
        return S(defs +
          `<rect x="22" y="18" width="88" height="56" rx="3" ${body}/>` +
          `<circle cx="66" cy="46" r="4.5" fill="#05060a" stroke="#4d5563" stroke-width="0.9"/>` +
          `<circle cx="66" cy="46" r="1.6" fill="#ffb43d" opacity="0.7"/>` +
          `<rect x="28" y="24" width="8" height="44" rx="2" fill="#1b1f27"/>`);

      default:
        return S(defs + `<rect x="12" y="18" width="108" height="56" rx="7" ${body}/>` + lens(66, 46, 24));
    }
  }

  /* ==================================================== 预览图管理 */
  const previewCache = new Map();

  function sceneImage(sceneId) {
    return `/assets/scenes/${sceneId}.jpg`;
  }

  function setPhoto(url) {
    const ph = $('vfPhoto');
    if (!ph) return;
    [ph, $('vfDofBlur'), $('vfMotion')].forEach((n) => {
      if (n) n.style.backgroundImage = `url("${url}")`;
    });
    ph.dataset.src = url;
    computeHistogram(url);
  }

  /* ==================================================== 直方图 */
  let histData = null;
  function computeHistogram(url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const W = 120, H = 90;
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, W, H);
      let d;
      try { d = g.getImageData(0, 0, W, H).data; } catch (e) { return; }
      const lum = new Uint32Array(64);
      const R = new Uint32Array(64), G = new Uint32Array(64), B = new Uint32Array(64);
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], gg = d[i + 1], bb = d[i + 2];
        const y = (0.2126 * r + 0.7152 * gg + 0.0722 * bb) | 0;
        lum[y >> 2]++; R[r >> 2]++; G[gg >> 2]++; B[bb >> 2]++;
      }
      histData = { lum, R, G, B };
      drawHistogram();
    };
    img.src = url;
  }

  function drawHistogram(bias) {
    const cv = $('vfHist');
    if (!cv || !histData) return;
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    const shift = Math.round(clamp((bias || 0) * 8, -40, 40));
    const max = Math.max(...histData.lum);
    // 通道
    const chans = [['R', '#ff5a4d'], ['G', '#53d17a'], ['B', '#4fa8ff']];
    g.globalCompositeOperation = 'lighter';
    chans.forEach(([k, col]) => {
      g.beginPath();
      g.fillStyle = col;
      g.globalAlpha = 0.34;
      const a = histData[k];
      g.moveTo(0, H);
      for (let i = 0; i < 64; i++) {
        const x = (i / 63) * W;
        const h = (a[i] / max) * H * 1.5;
        g.lineTo(x, H - Math.min(H, h));
      }
      g.lineTo(W, H); g.closePath(); g.fill();
    });
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.beginPath();
    g.strokeStyle = 'rgba(255,255,255,0.72)';
    g.lineWidth = 1.2;
    g.moveTo(0, H);
    for (let i = 0; i < 64; i++) {
      const idx = clamp(i + (shift >> 2), 0, 63);
      const x = (i / 63) * W;
      const h = (histData.lum[idx] / max) * H * 1.5;
      g.lineTo(x, H - Math.min(H, h));
    }
    g.lineTo(W, H); g.closePath(); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      g.beginPath(); g.moveTo((W / 4) * i, 0); g.lineTo((W / 4) * i, H); g.stroke();
    }
  }

  /* ==================================================== 主渲染 */
  function apply(state, o) {
    const vf = $('vf');
    const bd = o.body, fl = o.film;

    // 画幅比例
    vf.style.setProperty('--vf-ratio', String(o.ratio));

    // --- 焦距 → 画面缩放（真实视角换算，等效于 焦距比）---
    const trueZoom = Math.tan(BASE_FOV * Math.PI / 360) / Math.tan(o.fovH * Math.PI / 360);
    const zoom = clamp(trueZoom, 1, ZOOM_MAX);
    vf.style.setProperty('--zoom', zoom.toFixed(3));

    // 裁切提示：真实视角落在底图之外时告诉用户
    const zt = $('vfZoomTag');
    if (trueZoom > ZOOM_MAX + 0.05) {
      zt.textContent = '长焦裁切 ×' + trueZoom.toFixed(1) + '（预览上限 ' + ZOOM_MAX + '×）';
      zt.classList.add('on');
    } else if (trueZoom < 0.995) {
      zt.textContent = '视角已超出底图范围（' + o.fovH.toFixed(0) + '°）';
      zt.classList.add('on');
    } else {
      zt.classList.remove('on');
    }

    // --- 曝光模拟（测光偏差 + 摄影师的曝光补偿）---
    const bias = o.exposure.bias + (state.evComp || 0);
    const bright = clamp(Math.pow(2, bias * 0.42), 0.32, 2.1);
    const f = FILM_FILTER[fl.id] || FILM_FILTER.digital;
    const sat = fl.bw ? 0 : f.s;
    vf.style.setProperty('--exp-b', bright.toFixed(3));
    vf.style.setProperty('--exp-c', (f.c * (1 + clamp(bias, -2, 2) * 0.03)).toFixed(3));
    vf.style.setProperty('--exp-s', String(sat));
    vf.style.setProperty('--tone-h', f.h + 'deg');
    $('vfExp').style.opacity = String(clamp(Math.abs(bias) * 0.16, 0, 0.55));

    // --- 黑白 ---
    vf.classList.toggle('bw', !!fl.bw);
    // --- 暗角 ---
    vf.classList.toggle('vignette', ['instant', 'tlr', 'view', 'pinhole'].includes(bd.grip) || state.lens <= 18);

    // --- 景深虚化：以焦平面为中心，越远越糊 ---
    const dist = Math.max(0.05, state.dist);
    const dTotal = o.dof.infinite ? dist * 8 : o.dof.total;
    const ratio = dTotal / dist;                       // 景深 / 拍摄距离
    const sharpness = clamp(ratio / 1.5, 0, 1);        // 1 = 前后全实
    const strong = state.technique === 'bokeh-pan' ? 1.3 : 1;
    const blurPx = (1 - sharpness) * 15 * strong;
    const db = $('vfDofBlur');
    db.style.setProperty('--dofblur', blurPx.toFixed(1) + 'px');
    db.style.setProperty('--dofw', (58 + 160 * sharpness).toFixed(0) + '%');
    db.style.setProperty('--dofh', (44 + 130 * sharpness).toFixed(0) + '%');
    db.style.opacity = String(clamp((1 - sharpness) * 0.96, 0, 0.96));

    // --- 运动 ---
    const mo = $('vfMotion');
    const mp = o.motion;
    const mAmt = clamp((mp.bgPx + mp.shakePx) / 90, 0, 1);
    mo.style.opacity = String(mAmt * 0.55);
    mo.style.filter = `blur(${(5 + mAmt * 16).toFixed(1)}px) brightness(.95)`;
    const ph = $('vfPhoto');
    if (mp.shakePx > 2) {
      const d = clamp(0.55 + mp.shakePx / 90, 0.5, 2.4);
      ph.style.animation = `shakeShift ${d.toFixed(2)}s ease-in-out infinite alternate`;
    } else {
      ph.style.animation = 'none';
    }

    // --- 颗粒 ---
    $('vfGrain').style.opacity = String(clamp(o.grain * 0.55, 0, 0.5));

    // --- 斑马纹 ---
    $('vfZebra').style.opacity = opts.zebra ? '0.45'
      : (bias > 1.2 ? String(clamp((bias - 1.2) * 0.3, 0, 0.5)) : '0');

    // --- 测光表 ---
    const meter = $('vfMeter');
    const clamped = clamp(bias, -3, 3);
    $('vfNeedle').style.bottom = (50 + clamped / 3 * 46).toFixed(1) + '%';
    $('vfMeterNum').textContent = (bias > 0 ? '+' : '') + bias.toFixed(1);
    meter.classList.toggle('warn', Math.abs(bias) > 1);

    // --- 景深标尺 ---
    const dofEl = $('vfDof');
    const near = o.dof.near, far = o.dof.far;
    const span = o.dof.infinite ? dist * 3 : Math.max(far, dist) * 1.2;
    const bar = $('vfDofBar');
    bar.style.left = clamp((near / span) * 100, 0, 100) + '%';
    bar.style.width = clamp(((Math.min(far, span) - near) / span) * 100, 1.5, 100) + '%';
    $('vfDofNear').textContent = fmtDist(near);
    $('vfDofFar').textContent = o.dof.infinite ? '∞' : fmtDist(far);

    // --- 读数 ---
    $('vfBody').textContent = bd.name.toUpperCase();
    $('vfSceneName').textContent = (o.scene.cn || '').toUpperCase();
    $('vfFormat').textContent = o.format.label.split(' ')[0].toUpperCase();
    $('vfFilmTag').textContent = fl.bw ? 'B&W' : (fl.stock ? 'FILM' : 'RAW');
    $('ivFocal').textContent = String(state.lens);
    $('ivAperture').textContent = 'f/' + window.ENGINE.fmtF(state.aperture);
    $('ivShutter').textContent = window.ENGINE.byShutter(state.shutter).label;
    $('ivIso').textContent = String(state.iso);
    $('ivFilm').textContent = fl.stock ? fl.name.replace(/Kodak |Fujifilm |Ilford |Kodak |CineStill /, '').split(' ').slice(0, 2).join(' ') : 'RAW';

    drawHistogram(o.exposure.bias);
    $('vfMeter').title = '测光 ' + (o.exposure.bias > 0 ? '+' : '') + o.exposure.bias.toFixed(1)
      + ' EV · 补偿 ' + ((state.evComp || 0) > 0 ? '+' : '') + (state.evComp || 0).toFixed(1) + ' EV';
  }

  function fmtDist(m) {
    if (!isFinite(m)) return '∞';
    if (m < 1) return (m * 100).toFixed(0) + 'cm';
    if (m < 10) return m.toFixed(2) + 'm';
    if (m < 1000) return m.toFixed(0) + 'm';
    return (m / 1000).toFixed(1) + 'km';
  }

  /* ==================================================== 对焦动画 */
  function focusHunt() {
    const af = $('vfAf');
    af.classList.remove('locked');
    af.classList.add('hunting');
    setTimeout(() => af.classList.remove('hunting'), 620);
  }
  function focusLock() {
    const af = $('vfAf');
    af.classList.add('locked');
    setTimeout(() => af.classList.remove('locked'), 1400);
  }

  /* ==================================================== 快门动作 */
  /**
   * 播放一次完整的曝光动作。
   * @returns {Promise<void>} 曝光动作结束（不含出图等待）
   */
  function fire(state, o, opts) {
    const kind = o.body.grip;
    const sh = $('vfShutter');
    const mir = $('vfMirror');
    const t = state.shutter;
    const hasFlash = state.flash !== 'none' && state.flash !== undefined;
    const isSLR = kind === 'slr' || kind === 'tlr' || kind === 'view';
    const curtainDur = clamp(Math.round(150 + Math.log2(1 / Math.max(t, 1 / 8000)) * 22), 130, 320);

    window.CAMSOUND.shutter(kind === 'slr' || kind === 'mirrorless' ? 'slr' : kind);

    return new Promise((resolve) => {
      if (hasFlash) {
        setTimeout(() => { window.CAMSOUND.flashPop(); }, 90);
      }
      // 反光板抬起（单反黑屏）
      if (isSLR) {
        mir.style.setProperty('--mdur', '260ms');
        mir.classList.add('on');
        setTimeout(() => mir.classList.remove('on'), 300);
      }
      // 帘幕
      sh.style.setProperty('--dur', curtainDur + 'ms');
      sh.classList.add('run');

      setTimeout(() => {
        if (hasFlash) {
          const fp = $('vfFlash');
          fp.classList.add('on');
          setTimeout(() => fp.classList.remove('on'), 380);
        }
        sh.classList.remove('run');
        if (opts && opts.onExposed) opts.onExposed();
        resolve();
      }, isSLR ? 300 : 90);
    });
  }

  /** B 门 / 长曝倒计时（把真实秒数压缩成观感时长） */
  function bulb(seconds) {
    const el = $('vfBulb');
    const arc = $('bulbArc');
    const tt = $('bulbT');
    const shown = clamp(0.9 + Math.log2(seconds + 0.3) * 0.42, 0.9, 4.2);
    el.classList.add('on');
    return new Promise((resolve) => {
      const t0 = performance.now();
      const loop = (now) => {
        const k = clamp((now - t0) / (shown * 1000), 0, 1);
        arc.setAttribute('stroke-dashoffset', String(314 * (1 - k)));
        tt.textContent = (seconds * k).toFixed(seconds < 4 ? 1 : 0) + 's';
        if (k < 1) requestAnimationFrame(loop);
        else { el.classList.remove('on'); resolve(); }
      };
      requestAnimationFrame(loop);
    });
  }

  /** 过片 / 转盘动作 */
  function advance(o) {
    const crank = $('crank');
    if (o.body.kind === 'digital') {
      crank.classList.add('adv');
      setTimeout(() => crank.classList.remove('adv'), 520);
      return;
    }
    const kind = o.body.advance || 'auto';
    window.CAMSOUND.advance(kind);
    crank.classList.add('adv');
    setTimeout(() => crank.classList.remove('adv'), 480);
  }

  function bindShakeKeyframes() {
    if (document.getElementById('shakeKF')) return;
    const st = document.createElement('style');
    st.id = 'shakeKF';
    st.textContent = '@keyframes shakeShift{' +
      '0%{transform:scale(var(--zoom,1)) translate(0,0)}' +
      '50%{transform:scale(var(--zoom,1)) translate(calc(var(--shake,6px)), calc(var(--shake,6px) * -0.4))}' +
      '100%{transform:scale(var(--zoom,1)) translate(calc(var(--shake,6px) * -0.6), calc(var(--shake,6px) * 0.5))}}';
    document.head.appendChild(st);
  }

  return {
    buildIris, setIris, bodySVG, setPhoto, apply, focusHunt, focusLock,
    fire, bulb, advance, bindShakeKeyframes, renderIris, sceneImage, fmtDist,
    drawHistogram, setOptions, FILM_FILTER, BASE_FOV
  };
})();
