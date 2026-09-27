/* ==========================================================================
   app.js —— 主控
   状态 → 光学计算 → 提示词 → 取景器渲染 → 快门 → 出图 → 胶卷
   ========================================================================== */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const E = window.ENGINE, C = window.CATALOG;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let S = E.stateFor('street-portrait', 'a7rv');
  let extra = '';
  let steps = 25;
  let seedText = '';
  let sceneCatFilter = '全部';
  let sceneQuery = '';
  let busy = false;
  let frameNo = 0;
  let mode = 'single';
  let cmpDim = 'aperture';
  let selectedForCompare = [];
  let serverOk = false;
  let lastPreviewUrl = null;

  /* ============================================================ 工具 */
  const DIST_MIN = 0.15, DIST_MAX = 2000;
  const distFromSlider = (v) => DIST_MIN * Math.pow(DIST_MAX / DIST_MIN, v / 100);
  const sliderFromDist = (d) => 100 * Math.log(clamp(d, DIST_MIN, DIST_MAX) / DIST_MIN) / Math.log(DIST_MAX / DIST_MIN);

  function toast(msg, kind, ms) {
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    if (kind === 'loading') t.innerHTML = '<span class="sp"></span><span>' + esc(msg) + '</span>';
    else t.textContent = msg;
    $('toasts').appendChild(t);
    if (kind !== 'loading') setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, ms || 2600);
    return t;
  }
  const toastDone = (el, msg, kind) => {
    if (!el) return;
    el.querySelector('.sp')?.remove();
    el.textContent = msg;
    el.className = 'toast' + (kind ? ' ' + kind : '');
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 320); }, 2400);
  };

  /* ============================================================ 控件构建 */
  function chips(container, items, isOn, label, onPick) {
    container.innerHTML = items.map((it, i) =>
      `<button class="chip${isOn(it, i) ? ' on' : ''}" data-i="${i}">${label ? label(it, i) : esc(it.cn || it)}</button>`
    ).join('');
    container.querySelectorAll('.chip').forEach((b) => {
      b.addEventListener('click', () => onPick(items[+b.dataset.i], +b.dataset.i));
    });
  }

  function refreshChipStates() {
    const mark = (sel, fn) => {
      document.querySelectorAll(sel + ' .chip').forEach((b, i) => {
        b.classList.toggle('on', fn(i));
      });
    };
    mark('#apChips', (i) => C.APERTURES[i].f === S.aperture);
    mark('#shChips', (i) => Math.abs(C.SHUTTERS[i].t - S.shutter) < 1e-9);
    mark('#filterChips', (i) => C.FILTERS[i].id === S.filter);
    mark('#flashChips', (i) => C.FLASHES[i].id === S.flash);
    mark('#compChips', (i) => window.COMPOSITIONS[i].id === S.composition);
    mark('#lensModChips', (i) => C.LENSMODS[i].id === S.lensMod);
    mark('#bodyChips', (i) => C.BODIES[i].id === S.body);
  }

  function buildBodies() {
    chips($('bodyChips'), C.BODIES, (b) => b.id === S.body,
      (b) => `<span class="k">${esc(b.cn)}</span>`,
      (b) => {
        S = E.switchBody(S, b.id);
        keepExposure();
        buildAll(); update();
        window.CAMSOUND.cock();
      });
  }

  /**
   * 切机身 / 切场景之后如果测光偏差超过 ±2 级，把曝光拉回来。
   * 幅度不大就不动 —— 用户可能是有意用 1/1000 去凝固运动的。
   *
   * 优先动快门；但如果当前手法锁住了快门（比如"追随拍摄"必须是 1/30），
   * 就改光圈 —— 这才是摄影师在暗处会做的事：开大光圈，而不是放弃手法。
   */
  function keepExposure() {
    const bd = E.byId(C.BODIES, S.body);
    const ev = E.evEffective(E.byId(window.SCENES, S.scene).ev, S.filter);
    if (Math.abs(E.optics(S).exposure.bias) <= 2) return;

    const tech = E.byId(window.TECHNIQUES, S.technique);
    const shutterLocked = !!(tech.force && tech.force.shutter) || bd.fixedAperture;
    if (shutterLocked && !bd.fixedAperture) {
      const want = ev + Math.log2(S.iso / 100);          // 目标 log2(N²/t)
      const N = Math.sqrt(S.shutter * Math.pow(2, want));
      S.aperture = E.byAperture(clamp(N, 1, 32)).f;
      if (Math.abs(E.optics(S).exposure.bias) <= 2) return;
    }
    S.shutter = snapShutter(E.pickShutter(ev, S.aperture, S.iso, bd), bd);
  }

  function buildLenses() {
    const idx = C.LENSES.findIndex((l) => l.mm === S.lens);
    $('lensRange').value = idx < 0 ? 6 : idx;
    $('lensVal').textContent = S.lens + 'mm';
  }

  function buildApertures() {
    chips($('apChips'), C.APERTURES, (a) => a.f === S.aperture,
      (a) => `f/${E.fmtF(a.f)}`,
      (a) => { S.aperture = a.f; VF.setIris(a.f, a.blades); update(); });
  }

  function buildShutters() {
    const bd = E.byId(C.BODIES, S.body);
    const list = shuttersFor(bd);
    chips($('shChips'), list, (x) => Math.abs(x.t - S.shutter) < 1e-9,
      (x) => x.label.replace(' (B门)', ''),
      (x) => { S.shutter = x.t; update(); });
  }

  /* 机身能力决定了可用的快门档：老式机械机没有 1/8000；
     但任何相机都有 B 门，所以超长曝光档始终可选 */
  function shuttersFor(bd) {
    const l = C.SHUTTERS.filter((x) =>
      x.t >= bd.minShutter - 1e-9 && (x.t <= bd.maxShutter + 1e-9 || x.label.indexOf('B门') >= 0));
    return l.length ? l : C.SHUTTERS;
  }

  function snapShutter(t, bd) {
    const l = shuttersFor(bd);
    return l.reduce((a, b) => (Math.abs(Math.log(b.t) - Math.log(t)) < Math.abs(Math.log(a.t) - Math.log(t)) ? b : a)).t;
  }

  /** 选定摄影手法后，自动把该手法的"标志性参数"装上去 */
  function applyTechniqueForce(t) {
    if (!t) return null;
    const bd = E.byId(C.BODIES, S.body);
    const notes = [];
    if (t.force && t.force.shutter) {
      const n = snapShutter(t.force.shutter, bd);
      if (n !== S.shutter) { S.shutter = n; notes.push(E.byShutter(n).label); }
    }
    if (t.force && t.force.aperture) {
      const f = t.force.aperture;
      if (f !== S.aperture) { S.aperture = f; notes.push('f/' + E.fmtF(f)); }
    }
    return notes.length ? notes.join(' · ') : null;
  }

  function buildIso() {
    const bd = E.byId(C.BODIES, S.body);
    const isDigital = bd.kind === 'digital';
    $('digitalIsoField').style.display = isDigital ? '' : 'none';
    if (!isDigital) return;
    const list = [50, 64, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600]
      .filter((v) => v <= bd.maxIso).map((v) => ({ v }));
    chips($('isoChips'), list, (x) => x.v === S.iso, (x) => String(x.v),
      (x) => { S.iso = x.v; update(); });
  }

  function buildFilms() {
    const bd = E.byId(C.BODIES, S.body);
    const wrap = $('filmGroups');
    const groups = {};
    C.FILMS.forEach((f) => {
      if (bd.kind === 'digital' && f.kind !== 'digital' && f.kind !== 'bw-conv') return;
      if (bd.kind === 'instant' && f.kind !== 'instant') return;
      if (bd.kind === 'film' && (f.kind === 'digital' || f.kind === 'instant')) return;
      const g = f.kind === 'digital' ? '数码' : (f.kind === 'bw-conv' ? '数码' : (f.brand || '其他'));
      (groups[g] = groups[g] || []).push(f);
    });
    wrap.innerHTML = Object.keys(groups).map((g) => `
      <div style="margin-bottom:7px">
        <div class="hint" style="margin:2px 0 4px;font-size:10px;letter-spacing:.08em">${esc(g)}</div>
        <div class="chips">
          ${groups[g].map((f) => `<button class="chip${f.id === S.film ? ' on' : ''}" data-fid="${f.id}">
            <span class="k" style="display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:4px;background:linear-gradient(135deg,${f.swatch[0]},${f.swatch[1]})"></span>${esc(f.cn)}
          </button>`).join('')}
        </div>
      </div>`).join('');
    wrap.querySelectorAll('.chip').forEach((b) => {
      b.addEventListener('click', () => {
        const f = C.FILMS.find((x) => x.id === b.dataset.fid);
        S.film = f.id;
        if (f.iso) S.iso = f.iso;
        buildFilms(); buildIso(); update();
      });
    });
    const cur = E.byId(C.FILMS, S.film);
    $('filmVal').textContent = cur.cn;
  }

  function buildTechs() {
    const cats = ['常规', '运动', '夜景', '特效', '技术', '光线', '光位'];
    const wrap = $('techChips');
    wrap.innerHTML = cats.map((cat) => {
      const arr = window.TECHNIQUES.filter((t) => t.cat === cat);
      if (!arr.length) return '';
      return `<div style="width:100%;margin-bottom:2px"><div class="hint" style="font-size:9.5px;letter-spacing:.1em;margin:5px 0 3px">${cat}</div>
        <div class="chips">${arr.map((t) => `<button class="chip${t.id === S.technique ? ' on' : ''}" data-tid="${t.id}">${esc(t.cn)}</button>`).join('')}</div></div>`;
    }).join('');
    wrap.querySelectorAll('.chip').forEach((b) => {
      b.addEventListener('click', () => {
        S.technique = b.dataset.tid;
        const t = window.TECHNIQUES.find((x) => x.id === S.technique);
        const forced = applyTechniqueForce(t);
        $('techNote').textContent = (t.note || '') + (forced ? `（已自动设为 ${forced}）` : '');
        buildTechs(); buildApertures(); buildShutters(); update();
      });
    });
    const t = E.byId(window.TECHNIQUES, S.technique);
    $('techNote').textContent = t.note || '';
  }

  function buildComps() {
    chips($('compChips'), window.COMPOSITIONS, (c) => c.id === S.composition,
      (c) => esc(c.cn), (c) => { S.composition = c.id; update(); });
  }

  function buildFilters() {
    chips($('filterChips'), C.FILTERS, (f) => f.id === S.filter, (f) => esc(f.cn),
      (f) => { S.filter = f.id; update(); });
  }

  function buildFlashes() {
    chips($('flashChips'), C.FLASHES, (f) => f.id === S.flash, (f) => esc(f.cn),
      (f) => { S.flash = f.id; if (f.id !== 'none') window.CAMSOUND.flashCharge(0.8); update(); });
  }

  function buildLensMods() {
    chips($('lensModChips'), C.LENSMODS, (m) => m.id === S.lensMod, (m) => esc(m.cn),
      (m) => { S.lensMod = m.id; $('lensModVal').textContent = m.cn; update(); });
    $('lensModVal').textContent = E.byId(C.LENSMODS, S.lensMod).cn;
  }

  function buildBodyCard() {
    const bd = E.byId(C.BODIES, S.body);
    $('bodyCard').innerHTML =
      VF.bodySVG(bd.grip) +
      `<div class="meta"><b>${esc(bd.cn)}</b><span>${esc(bd.trait)}</span>
        <span style="color:var(--ink-3);margin-top:4px">${esc((C.FORMATS[bd.format] || {}).label || '')} · ${bd.kind === 'digital' ? '数码' : (bd.kind === 'instant' ? '即时成像' : '胶片')}</span></div>`;
  }

  /* ============================================================ 自动焦距 / 自动测光 */
  /* 按场景类别给一个"135 等效"建议焦距，再折回当前画幅的真实焦距 */
  const AUTO_FOCAL_EQ = {
    '人像': 85, '风光': 24, '夜景': 35, '建筑': 24, '纪实': 35,
    '运动': 300, '自然': 400, '微距': 105, '静物': 100, '生活': 50
  };
  const AUTO_FOCAL_ID = {
    'street-portrait': 50, 'street-doc': 35, 'market': 35, 'old-town': 35,
    'misty-forest': 35, 'snowfield': 50, 'cafe-window': 50, 'food': 50,
    'seaside': 24, 'starscape': 14, 'interior': 18, 'car-night': 35,
    'flower-macro': 105, 'insect-macro': 105
  };

  function autoFocal() {
    const sc = E.byId(window.SCENES, S.scene);
    const bd = E.byId(C.BODIES, S.body);
    const fmt = C.FORMATS[bd.format] || C.FORMATS.ff;
    const eq = AUTO_FOCAL_ID[S.scene] || AUTO_FOCAL_EQ[sc.cat] || 50;
    const actual = eq * (fmt.sensorW / 36);
    // 吸附到镜头库里最接近的一支
    const lens = E.byLens(actual);
    S.lens = lens.mm;
    $('lensRange').value = String(C.LENSES.findIndex((l) => l.mm === lens.mm));
    toast(`自动焦距：等效 ${eq}mm → ${lens.mm}mm（${fmt.label}）`, 'ok');
  }

  function autoExpose() {
    const bd = E.byId(C.BODIES, S.body);
    const ev = E.evEffective(E.byId(window.SCENES, S.scene).ev, S.filter);
    const t = E.pickShutter(ev, S.aperture, S.iso, bd);
    S.shutter = snapShutter(t, bd);
    toast('自动测光：快门 ' + E.byShutter(S.shutter).label
      + `（f/${E.fmtF(S.aperture)} · ISO ${S.iso} · 场景 EV ${ev.toFixed(1)}）`, 'ok');
  }

  function buildLensHelpers() {
    chips($('lensAutoChips'),
      [ { k: 'auto', cn: '自动（按场景）' },
        { k: 'wide', cn: '广角 24' }, { k: 'std', cn: '标准 50' },
        { k: 'port', cn: '人像 85' }, { k: 'tele', cn: '长焦 200' } ],
      () => false, (x) => esc(x.cn), (x) => {
        if (x.k === 'auto') { autoFocal(); }
        else {
          const bd = E.byId(C.BODIES, S.body);
          const fmt = C.FORMATS[bd.format] || C.FORMATS.ff;
          const eqMap = { wide: 24, std: 50, port: 85, tele: 200 };
          S.lens = E.byLens(eqMap[x.k] * (fmt.sensorW / 36)).mm;
          $('lensRange').value = String(C.LENSES.findIndex((l) => l.mm === S.lens));
        }
        buildLenses(); update();
      });
  }

  /* ============================================================ 场景库 */
  function buildScenes() {
    const cats = ['全部', ...Array.from(new Set(window.SCENES.map((s) => s.cat)))];
    $('sceneCats').innerHTML = cats.map((c) =>
      `<button class="${c === sceneCatFilter ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('');
    $('sceneCats').querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => { sceneCatFilter = b.dataset.c; buildScenes(); });
    });

    const list = window.SCENES.filter((s) => {
      if (sceneCatFilter !== '全部' && s.cat !== sceneCatFilter) return false;
      if (sceneQuery && !(s.cn + s.cat + s.id).toLowerCase().includes(sceneQuery.toLowerCase())) return false;
      return true;
    });

    $('sceneGrid').innerHTML = list.map((s) => {
      const h = 200 + ((s.id.length * 37) % 120);
      return `<div class="scene-tile${s.id === S.scene ? ' on' : ''}" data-sid="${esc(s.id)}" title="${esc(s.note)}">
        <div class="ph" style="--h:${h}">${esc(s.cn)}</div>
        <img src="/assets/scenes/${s.id}.jpg" alt="" loading="lazy"
             onerror="this.style.display='none'" />
        <div class="cap">${esc(s.cn)}<span class="cat">${esc(s.cat)}</span></div>
      </div>`;
    }).join('');

    $('sceneGrid').querySelectorAll('.scene-tile').forEach((t) => {
      t.addEventListener('click', () => pickScene(t.dataset.sid));
    });
  }

  function pickScene(id) {
    S = E.switchScene(S, id);      // 只换场景，保留机身 / 胶片 / 手法等创作决定
    keepExposure();
    buildAll(); update();
    loadPreview(id);
    window.CAMSOUND.cock();
  }

  function buildQuickPresets() {
    chips($('quickPresets'), window.QUICK_PRESETS, () => false, (q) => esc(q.cn), (q) => {
      S = Object.assign(E.defaultState(), q.state);
      S.dist = S.dist || E.byId(window.SCENES, S.scene).dist;
      buildAll(); update(); loadPreview(S.scene);
      toast('已装载配方：' + q.cn, 'ok');
    });
  }

  /* ============================================================ 预览图 */
  function setPreviewBackground(css) {
    ['vfPhoto', 'vfDofBlur', 'vfMotion'].forEach((id) => {
      const n = $(id);
      if (n) n.style.backgroundImage = css;
    });
  }

  function loadPreview(sceneId) {
    const url = `/assets/scenes/${sceneId}.jpg`;
    const probe = new Image();
    probe.onload = () => { lastPreviewUrl = url; VF.setPhoto(url); };
    probe.onerror = () => {
      lastPreviewUrl = null;
      const h = 200 + ((sceneId.length * 37) % 120);
      setPreviewBackground(`linear-gradient(150deg, hsl(${h} 32% 20%), hsl(${h + 30} 40% 9%) 70%)`);
    };
    probe.src = url;
  }

  /* ============================================================ 更新 */
  let lastAssembled = null;

  function update() {
    const o = E.optics(S);
    const built = E.assemble(S, extra);
    lastAssembled = built;

    // 取景器
    VF.apply(S, o);
    VF.setIris(S.aperture, E.byAperture(S.aperture).blades);

    // 面板读数
    $('lensVal').textContent = S.lens + 'mm';
    $('apVal').textContent = 'f/' + E.fmtF(S.aperture);
    $('shVal').textContent = E.byShutter(S.shutter).label;
    $('isoVal').textContent = String(S.iso);
    $('distVal').textContent = E.fmtDist ? E.fmtDist(S.dist) : VF.fmtDist(S.dist);
    $('distVal').textContent = VF.fmtDist(S.dist);
    $('stepsVal').textContent = String(steps);
    $('seedVal').textContent = seedText || '随机';

    // 工具栏
    $('ctScene').textContent = o.scene.cn;
    $('ctNote').textContent = o.scene.note;

    // 光学提示
    const fStops = o.exposure.filterStops;
    $('opticsHint').innerHTML =
      `视角 <b>${o.fovH.toFixed(1)}°</b>（等效 ${o.equiv.toFixed(0)}mm） · ` +
      `景深 <b>${o.dof.infinite ? '从 ' + VF.fmtDist(o.dof.near) + ' 到 ∞' : VF.fmtDist(o.dof.near) + ' – ' + VF.fmtDist(o.dof.far)}</b> · ` +
      `超焦距 ${VF.fmtDist(o.dof.hyperfocal)}<br>` +
      `主体运动位移 <b>${o.motion.subjectPx.toFixed(1)} px</b> · ` +
      `背景 ${o.motion.bgPx.toFixed(0)} px · ` +
      `${o.motion.handheld ? '<span style="color:var(--red)">低于安全快门，手持会抖</span>' : '手持安全'}` +
      (fStops ? `<br>滤镜减光 <b>${fStops} 级</b> → 场景有效 EV ${o.exposure.evEffective.toFixed(1)}（原始 ${o.exposure.evScene}）` : '');

    // 提示词
    renderPrompt(built);

    // EXIF 速览
    $('exifNow').innerHTML = exifRows(S, o);

    refreshChipStates();
    $('lensVal').textContent = S.lens + 'mm';
  }

  function exifRows(s, o) {
    const rows = [
      ['场景', o.scene.cn],
      ['机身', o.body.cn],
      ['焦距', `${s.lens}mm / 等效 ${o.equiv.toFixed(0)}mm`],
      ['视角', `${o.fovH.toFixed(1)}° × ${o.fovV.toFixed(1)}°`],
      ['光圈', 'f/' + E.fmtF(s.aperture)],
      ['快门', E.byShutter(s.shutter).label],
      ['ISO', String(s.iso)],
      ['胶片', o.film.cn],
      ['景深', o.dof.infinite ? `${VF.fmtDist(o.dof.near)} → ∞` : `${VF.fmtDist(o.dof.near)} – ${VF.fmtDist(o.dof.far)}`],
      ['测光', `${o.exposure.bias > 0 ? '+' : ''}${o.exposure.bias.toFixed(1)} EV · ${({ good: '准确', over: '过曝', under: '欠曝' })[o.exposure.verdict]}`],
      ['场景 EV', `${o.exposure.evEffective.toFixed(1)}${o.exposure.filterStops ? `（含滤镜 ${o.exposure.filterStops} 级）` : ''}`],
      ['曝光补偿', `${(s.evComp || 0) > 0 ? '+' : ''}${(s.evComp || 0).toFixed(1)} EV`],
      ['颗粒', o.grain.toFixed(2)]
    ];
    return rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  }

  const SEG_COLOR = {
    scene: '#8fd0ff', technique: '#ffb43d', composition: '#c79bff', lens: '#5be0b0',
    aperture: '#ffd166', shutter: '#ff8f6b', film: '#e6a8d7', light: '#ffe08a',
    flash: '#ff9de2', filter: '#a0e0ff', body: '#b9c0cd', quality: '#7a8494', extra: '#ffffff'
  };

  function renderPrompt(built) {
    $('promptBox').innerHTML = built.segments.map((sg) =>
      `<span class="frag" style="color:${SEG_COLOR[sg.key] || '#b9c0cd'}" title="${esc(sg.label)}">${esc(sg.text)}</span>`
    ).join('<span style="color:var(--ink-3)">, </span>');
  }

  /* ============================================================ 快门 */
  function currentMeta(o, built) {
    const bd = E.byId(C.BODIES, S.body);
    return {
      sceneCn: o.scene.cn,
      bodyCn: bd.cn,
      focal: S.lens,
      equiv: Math.round(o.equiv),
      aperture: 'f/' + E.fmtF(S.aperture),
      shutter: E.byShutter(S.shutter).label,
      iso: S.iso,
      filmCn: o.film.cn,
      filmShort: o.film.stock ? o.film.name.split(' ')[0] : 'RAW',
      bw: !!o.film.bw,
      techCn: E.byId(window.TECHNIQUES, S.technique).cn,
      compCn: E.byId(window.COMPOSITIONS, S.composition).cn,
      dist: VF.fmtDist(S.dist),
      fov: `${o.fovH.toFixed(1)}°`,
      dof: o.dof.infinite ? `${VF.fmtDist(o.dof.near)} → ∞` : `${VF.fmtDist(o.dof.near)}–${VF.fmtDist(o.dof.far)}`,
      meter: `${o.exposure.bias > 0 ? '+' : ''}${o.exposure.bias.toFixed(1)} EV`,
      aspect: o.ratio
    };
  }

  function stateSnapshot(o) {
    return {
      scene: S.scene, body: S.body, lens: S.lens, lensMod: S.lensMod,
      aperture: S.aperture, shutter: S.shutter, iso: S.iso, film: S.film,
      filter: S.filter, flash: S.flash, technique: S.technique,
      composition: S.composition, dist: S.dist, steps, extra, evComp: S.evComp || 0,
      grain: o.grain, fov: o.fovH.toFixed(1)
    };
  }

  async function generate(state, o, built, seed) {
    const w = 1408, h = Math.round(1408 / o.ratio / 32) * 32;   // 32 的倍数，Qwen 要求
    const r = await fetch('/api/shot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: built.positive,
        negative_prompt: built.negative,
        width: w, height: h,
        steps: steps, cfg: 1.0,
        seed: seed == null || seed === '' ? -1 : Number(seed),
        meta: currentMeta(o, built),
        label: o.scene.cn
      })
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status} ${txt.slice(0, 200)}`);
    }
    const shot = await r.json();
    shot.state = stateSnapshot(o);
    return shot;
  }

  async function takeShot(opts) {
    if (busy) return;
    busy = true;
    $('shutterBtn').classList.add('disabled');

    const o = E.optics(S);
    const built = E.assemble(S, extra);
    const bd = E.byId(C.BODIES, S.body);

    window.CAMSOUND.cock();
    VF.focusHunt();
    await sleep(320);
    VF.focusLock();
    window.CAMSOUND.focus(true);
    await sleep(140);

    // 曝光动作
    await VF.fire(S, o, {});
    if (S.shutter >= 1) {
      $('shutterBtn').classList.add('bulb');
      await VF.bulb(S.shutter);
      $('shutterBtn').classList.remove('bulb');
    }
    VF.advance(o);
    frameNo++;
    $('frameCounter').textContent = String(frameNo).padStart(2, '0');

    // 出图
    $('vfBusy').classList.add('on');
    $('vfBusySub').textContent = '把参数翻译成画面…';
    const t = toast('显影中… 约 13–25 秒', 'loading');

    try {
      const shot = await generate(stateSnapshot(o), o, built, seedText);
      GALLERY.add(shot, true);
      toastDone(t, `第 ${frameNo} 张完成 · ${shot.elapsed}s`, 'ok');
      showReview(shot.url);
      if (opts && opts.after) opts.after(shot);
    } catch (err) {
      toastDone(t, '出图失败：' + err.message, 'err');
      console.error(err);
    } finally {
      $('vfBusy').classList.remove('on');
      $('shutterBtn').classList.remove('disabled');
      busy = false;
    }
  }

  function showReview(url) {
    let el = $('vfReview');
    if (!el) {
      el = document.createElement('div');
      el.id = 'vfReview';
      el.style.cssText = 'position:absolute;inset:0;z-index:35;background-size:cover;background-position:center;opacity:0;transition:opacity .28s ease;pointer-events:none';
      $('vf').appendChild(el);
    }
    el.style.backgroundImage = `url("${url}")`;
    el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, 2200);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ============================================================ 对比试拍 */
  const CMP_PAIRS = {
    aperture: { a: 1.4, b: 16, head: (v) => 'f/' + E.fmtF(v), title: '光圈' },
    shutter: { a: 1 / 1000, b: 1 / 8, head: (v, s) => E.byShutter(v).label, title: '快门' },
    lens: { a: 24, b: 200, head: (v) => v + 'mm', title: '焦距' },
    film: { a: 'portra400', b: 'tri-x400', head: (v) => E.byId(C.FILMS, v).cn, title: '胶片' },
    technique: { a: 'freeze', b: 'panning', head: (v) => E.byId(window.TECHNIQUES, v).cn, title: '手法' }
  };

  async function runCompare() {
    if (busy) { toast('正在出图中，稍候', 'err'); return; }
    let stateA, stateB, headA, headB, title;

    if (cmpDim === 'selected') {
      const sel = GALLERY.list().filter((s) => selectedForCompare.includes(s.id));
      if (sel.length < 2) { toast('请在胶卷里点选两张照片（点右上角"选两张对比"）', 'err'); return; }
      const [x, y] = sel;
      GALLERY.renderCompare('selected',
        { head: x.meta.aperture + ' · ' + x.meta.shutter, sub: x.meta.filmCn, url: x.url },
        { head: y.meta.aperture + ' · ' + y.meta.shutter, sub: y.meta.filmCn, url: y.url },
        `<div>${esc(x.meta.sceneCn)} · ${esc(x.meta.bodyCn)} · ${esc(x.meta.focal)}mm · ${esc(x.meta.dof)}</div>`,
        `<div>${esc(y.meta.sceneCn)} · ${esc(y.meta.bodyCn)} · ${esc(y.meta.focal)}mm · ${esc(y.meta.dof)}</div>`);
      return;
    }

    const cfg = CMP_PAIRS[cmpDim];
    title = cfg.title;
    stateA = Object.assign({}, S);
    stateB = Object.assign({}, S);
    if (cmpDim === 'aperture') { stateA.aperture = cfg.a; stateB.aperture = cfg.b; }
    if (cmpDim === 'shutter') { stateA.shutter = cfg.a; stateB.shutter = cfg.b; }
    if (cmpDim === 'lens') { stateA.lens = cfg.a; stateB.lens = cfg.b; }
    if (cmpDim === 'film') { stateA.film = cfg.a; stateA.iso = E.byId(C.FILMS, cfg.a).iso; stateB.film = cfg.b; stateB.iso = E.byId(C.FILMS, cfg.b).iso; }
    if (cmpDim === 'technique') { stateA.technique = cfg.a; stateB.technique = cfg.b; }

    // 自动纠正测光，让对比只体现"那一个变量"
    const evScene = E.evEffective(E.byId(window.SCENES, S.scene).ev, S.filter);
    if (['aperture', 'shutter', 'film'].includes(cmpDim)) {
      const bd = E.byId(C.BODIES, S.body);
      stateA.shutter = E.pickShutter(evScene, stateA.aperture, stateA.iso, bd);
      stateB.shutter = E.pickShutter(evScene, stateB.aperture, stateB.iso, bd);
    }
    // 焦距对比要固定曝光，否则两张亮度不一样就比不出透视差异
    if (cmpDim === 'lens') {
      const bd = E.byId(C.BODIES, S.body);
      stateA.shutter = E.pickShutter(evScene, stateA.aperture, stateA.iso, bd);
      stateB.shutter = stateA.shutter;
    }
    if (cmpDim === 'shutter') { stateA.shutter = cfg.a; stateB.shutter = cfg.b; }
    if (cmpDim === 'technique') { stateA.filter = S.filter; stateB.filter = S.filter; }

    const oA = E.optics(stateA), oB = E.optics(stateB);
    const bA = E.assemble(stateA, extra), bB = E.assemble(stateB, extra);

    const label = (v) => (typeof v === 'number' && (cmpDim === 'aperture' ? true : false)) ? cfg.head(v) : cfg.head(v);
    headA = cfg.head(cmpDim === 'shutter' ? cfg.a : (cmpDim === 'film' ? cfg.a : (cmpDim === 'technique' ? cfg.a : cfg.a)), stateA);
    headB = cfg.head(cmpDim === 'shutter' ? cfg.b : (cmpDim === 'film' ? cfg.b : (cmpDim === 'technique' ? cfg.b : cfg.b)), stateB);

    GALLERY.compareLoading(headA, headB);
    busy = true;
    $('shutterBtn').classList.add('disabled');

    try {
      const t = toast(`对比出图中：${title} · 两张`, 'loading');
      const sA = await generate(stateSnapshot(oA), oA, bA, seedText);
      GALLERY.renderCompare(cmpDim,
        { head: headA, sub: `${oA.dof.infinite ? VF.fmtDist(oA.dof.near) + '→∞' : VF.fmtDist(oA.dof.near) + '–' + VF.fmtDist(oA.dof.far)} · ${oA.motion.subjectPx.toFixed(1)}px`, url: sA.url },
        { head: headB, sub: `${oB.dof.infinite ? VF.fmtDist(oB.dof.near) + '→∞' : VF.fmtDist(oB.dof.near) + '–' + VF.fmtDist(oB.dof.far)} · ${oB.motion.subjectPx.toFixed(1)}px`, url: '' },
        diffHtml(bA, bB), '显影中…');
      const sB = await generate(stateSnapshot(oB), oB, bB, seedText);
      GALLERY.renderCompare(cmpDim,
        { head: headA, sub: `${oA.dof.infinite ? '∞' : VF.fmtDist(oA.dof.far)}`, url: sA.url },
        { head: headB, sub: `${oB.dof.infinite ? '∞' : VF.fmtDist(oB.dof.far)}`, url: sB.url },
        diffHtml(bA, bB), diffHtml(bB, bA));
      GALLERY.add(sA, false); GALLERY.add(sB, true);
      toastDone(t, '对比完成', 'ok');
    } catch (err) {
      toastDone(toast('失败：' + err.message, 'err'), '');
    } finally {
      busy = false;
      $('shutterBtn').classList.remove('disabled');
    }
  }

  function diffHtml(b1, b2) {
    const map = {};
    b2.segments.forEach((s) => { map[s.key] = s.text; });
    const out = [];
    b1.segments.forEach((s) => {
      if (map[s.key] !== undefined && map[s.key] !== s.text) {
        out.push(`<div><em>${esc(s.label)}</em>：${esc(s.text)}</div>`);
      }
    });
    return out.length ? out.join('') : '<div>两组参数完全一致。</div>';
  }

  /* ============================================================ 课程抽屉 */
  function openDrawer() {
    const body = $('drawerBody');
    body.innerHTML = window.LESSONS.map((L) => `
      <div class="lesson">
        <h4><span class="no">${L.no}</span>${esc(L.title)}</h4>
        <p>${esc(L.body)}</p>
        <ul>${L.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
        <div class="acts">
          <button class="btn ghost" data-load="${L.no}">载入这节课</button>
          <button class="btn ghost" data-cmp="${L.no}">按这节课做对比</button>
        </div>
      </div>`).join('');
    body.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', () => {
      const L = window.LESSONS.find((x) => x.no === b.dataset.load);
      S = Object.assign(E.defaultState(), L.preset);
      S.dist = S.dist || E.byId(window.SCENES, S.scene).dist;
      buildAll(); update(); loadPreview(S.scene); closeDrawer();
      toast('已载入：' + L.title, 'ok');
    }));
    body.querySelectorAll('[data-cmp]').forEach((b) => b.addEventListener('click', () => {
      const L = window.LESSONS.find((x) => x.no === b.dataset.cmp);
      S = Object.assign(E.defaultState(), L.preset);
      S.dist = S.dist || E.byId(window.SCENES, S.scene).dist;
      cmpDim = L.compare.dim;
      buildAll(); update(); loadPreview(S.scene); closeDrawer();
      $('cmpDim').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.dim === cmpDim));
      setMode('compare');
      toast(L.compare.tip, 'ok', 6000);
      runCompare();
    }));
    $('drawer').classList.add('on');
  }
  const closeDrawer = () => $('drawer').classList.remove('on');

  /* ============================================================ 模式 / 快捷键 */
  function setMode(m) {
    mode = m;
    $('modeSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    if (m === 'compare') $('compare').classList.add('on');
    else { $('compare').classList.remove('on'); clearSelection(); }
    if (m === 'lesson') openDrawer();
  }

  function bind() {
    GALLERY.bind();
    GALLERY.setRenderHook(() => { if (selecting) hookStripSelection(); });
    GALLERY.setHandlers({
      redo: (shot) => { if (shot.state) applySnapshot(shot.state); setTimeout(() => takeShot({}), 100); },
      load: (shot) => { if (shot.state) { applySnapshot(shot.state); toast('已载入这套参数', 'ok'); } },
      del: async (shot) => {
        try { await fetch('/api/gallery/' + shot.id, { method: 'DELETE' }); } catch (e) { }
        GALLERY.remove(shot.id);
      }
    });

    // 折叠面板
    document.querySelectorAll('.sect > h3').forEach((h) => {
      h.addEventListener('click', () => h.parentElement.classList.toggle('closed'));
    });

    // 模式
    $('modeSeg').querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => setMode(b.dataset.mode));
    });

    // 焦距
    $('lensRange').addEventListener('input', (e) => {
      S.lens = C.LENSES[+e.target.value].mm;
      $('lensVal').textContent = S.lens + 'mm';
      update();
    });

    // 距离
    $('distRange').addEventListener('input', (e) => {
      S.dist = +distFromSlider(+e.target.value).toFixed(2);
      update();
    });

    // 曝光补偿（有意偏离测光表：同时影响取景器曝光模拟与提示词）
    $('evRange').addEventListener('input', (e) => {
      const v = +e.target.value;
      $('evVal').textContent = (v > 0 ? '+' : '') + v.toFixed(1) + ' EV';
      S.evComp = v;
      update();
    });

    // 生成设置
    $('stepsRange').addEventListener('input', (e) => { steps = +e.target.value; $('stepsVal').textContent = String(steps); });
    $('seedInput').addEventListener('input', (e) => { seedText = e.target.value.trim(); $('seedVal').textContent = seedText || '随机'; });
    $('extraPrompt').addEventListener('input', (e) => { extra = e.target.value; update(); });

    $('shutterBtn').addEventListener('click', () => takeShot({}));
    $('btnShoot').addEventListener('click', () => takeShot({}));
    $('btnAutoExpose').addEventListener('click', () => {
      autoExpose(); buildShutters(); update();
    });

    // 顶栏开关
    $('btnGrid').addEventListener('click', (e) => {
      const off = $('vfMarks').classList.toggle('off');
      e.currentTarget.classList.toggle('on', !off);
    });
    $('btnGrid').classList.add('on');
    $('btnSound').addEventListener('click', (e) => {
      const on = window.CAMSOUND.enable(!window.CAMSOUND.on);
      e.currentTarget.classList.toggle('on', on);
      if (on) { window.CAMSOUND.beep(); toast('相机音效已开启', 'ok'); }
    });
    $('btnKeys').addEventListener('click', () => {
      const el = $('keys');
      el.classList.toggle('on');
    });
    $('keysClose').addEventListener('click', () => $('keys').classList.remove('on'));
    $('btnImmerse').addEventListener('click', () => {
      const on = document.body.classList.toggle('immersive');
      $('btnImmerse').classList.toggle('on', on);
      if (on) setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 480);
    });

    $('tglHist').addEventListener('click', (e) => {
      const on = $('vfHist').classList.toggle('on');
      e.currentTarget.classList.toggle('on', on);
      VF.drawHistogram(E.optics(S).exposure.bias);
    });
    $('tglZebra').addEventListener('click', (e) => {
      const on = !$('vfZebra').classList.contains('force');
      $('vfZebra').classList.toggle('force', on);
      e.currentTarget.classList.toggle('on', on);
      VF.setOptions({ zebra: on });
      update();
    });
    $('tglDof').addEventListener('click', (e) => {
      const on = $('vfDof').classList.toggle('on');
      e.currentTarget.classList.toggle('on', on);
    });

    // 场景搜索
    $('sceneSearch').addEventListener('input', (e) => { sceneQuery = e.target.value; buildScenes(); });

    // 提示词复制
    $('btnCopyPrompt').addEventListener('click', () => {
      navigator.clipboard?.writeText(lastAssembled.positive).then(() => toast('正向提示词已复制', 'ok'));
    });
    $('btnCopyNeg').addEventListener('click', () => {
      navigator.clipboard?.writeText(lastAssembled.negative).then(() => toast('负向提示词已复制', 'ok'));
    });

    // 对比
    $('cmpDim').querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        cmpDim = b.dataset.dim;
        $('cmpDim').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      });
    });
    $('cmpRun').addEventListener('click', runCompare);
    $('cmpClose').addEventListener('click', () => setMode('single'));
    $('btnCompareFrom').addEventListener('click', () => {
      setMode('compare');
      cmpDim = 'selected';
      $('cmpDim').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.dim === 'selected'));
      enableSelection();
      toast('在底部胶卷里点选两张照片，然后按「开始对比」', 'ok', 5000);
    });
    $('btnClear').addEventListener('click', async () => {
      if (!confirm('清空整个胶卷？所有已生成的图片都会被删除。')) return;
      try { await fetch('/api/gallery', { method: 'DELETE' }); } catch (e) { }
      GALLERY.replaceAll([]);
    });

    // 键盘
    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea')) return;
      const k = e.key.toLowerCase();
      if (e.code === 'Space') { e.preventDefault(); takeShot({}); return; }
      if (k === 'f') { $('btnImmerse').click(); }
      if (k === 'g') { $('btnGrid').click(); }
      if (k === 'l') openDrawer();
      if (k === 'c') setMode('compare');
      if (k === 'a') { autoFocal(); buildLenses(); update(); }
      if (k === 'e') { autoExpose(); buildShutters(); update(); }
      if (k === 'escape') {
        $('compare').classList.remove('on');
        closeDrawer(); GALLERY.closeLightbox();
        $('keys').classList.remove('on');
        $('modeSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === 'single'));
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const i = C.LENSES.findIndex((l) => l.mm === S.lens);
        const n = clamp(i + (e.key === 'ArrowRight' ? 1 : -1), 0, C.LENSES.length - 1);
        S.lens = C.LENSES[n].mm; $('lensRange').value = n; update();
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const i = C.APERTURES.findIndex((a) => a.f === S.aperture);
        const n = clamp(i + (e.key === 'ArrowUp' ? 1 : -1), 0, C.APERTURES.length - 1);
        S.aperture = C.APERTURES[n].f; update();
      }
      if (e.key === '[' || e.key === ']') {
        const i = C.SHUTTERS.findIndex((x) => x.t === S.shutter);
        const n = clamp(i + (e.key === ']' ? 1 : -1), 0, C.SHUTTERS.length - 1);
        S.shutter = C.SHUTTERS[n].t; update();
      }
      if (e.key >= '1' && e.key <= '9') {
        const idx = +e.key - 1;
        if (window.QUICK_PRESETS[idx]) {
          S = Object.assign(E.defaultState(), window.QUICK_PRESETS[idx].state);
          S.dist = S.dist || E.byId(window.SCENES, S.scene).dist;
          buildAll(); update(); loadPreview(S.scene);
        }
      }
    });
  }

  let selecting = false;

  function enableSelection() {
    selectedForCompare = [];
    selecting = true;
    hookStripSelection();
  }

  /** 给胶卷条挂"点选两张"的拦截器；用 dataset 标记避免重复挂载 */
  function hookStripSelection() {
    $('filmstrip').querySelectorAll('.frame').forEach((f) => {
      if (f.dataset.selHooked) return;
      f.dataset.selHooked = '1';
      f.addEventListener('click', (ev) => {
        if (!selecting) return;
        ev.stopPropagation();
        ev.preventDefault();
        const id = f.dataset.id;
        const i = selectedForCompare.indexOf(id);
        if (i >= 0) selectedForCompare.splice(i, 1);
        else {
          if (selectedForCompare.length >= 2) selectedForCompare.shift();
          selectedForCompare.push(id);
        }
        $('filmstrip').querySelectorAll('.frame').forEach((x) =>
          x.classList.toggle('on', selectedForCompare.includes(x.dataset.id)));
      }, true);
    });
  }

  function clearSelection() {
    selecting = false;
    selectedForCompare = [];
    $('filmstrip').querySelectorAll('.frame.on').forEach((x) => x.classList.remove('on'));
  }

  function applySnapshot(snap) {
    S = Object.assign(E.defaultState(), {
      scene: snap.scene, body: snap.body, lens: snap.lens, lensMod: snap.lensMod,
      aperture: snap.aperture, shutter: snap.shutter, iso: snap.iso, film: snap.film,
      filter: snap.filter, flash: snap.flash, technique: snap.technique,
      composition: snap.composition, dist: snap.dist
    });
    if (snap.steps) { steps = snap.steps; $('stepsRange').value = steps; }
    if (snap.extra != null) { extra = snap.extra; $('extraPrompt').value = extra; }
    if (snap.evComp != null) {
      S.evComp = snap.evComp; $('evRange').value = String(snap.evComp);
      $('evVal').textContent = (snap.evComp > 0 ? '+' : '') + snap.evComp.toFixed(1) + ' EV';
    }
    buildAll(); update(); loadPreview(S.scene);
  }

  /* ============================================================ 初始化 */
  function buildAll() {
    const bd0 = E.byId(C.BODIES, S.body);
    S.shutter = snapShutter(S.shutter, bd0);            // 机身换了就把快门收进它的能力范围
    if (bd0.fixedAperture) S.aperture = E.byAperture(Math.min(32, bd0.fixedAperture)).f;
    buildBodies(); buildLenses(); buildLensHelpers(); buildApertures(); buildShutters();
    buildIso(); buildFilms(); buildTechs(); buildComps(); buildFilters();
    buildFlashes(); buildLensMods(); buildBodyCard(); buildScenes(); buildQuickPresets();
    const bd = E.byId(C.BODIES, S.body);
    $('crank').classList.toggle('digital', bd.kind === 'digital');
    $('crankLabel').textContent = bd.kind === 'digital' ? '模式转盘'
      : (bd.advance === 'auto' ? '自动过片' : (bd.advance === 'crank' ? '摇柄' : '过片杆'));
    $('distRange').value = String(sliderFromDist(S.dist).toFixed(1));
  }

  async function checkServer() {
    const el = $('statusLight');
    try {
      const r = await fetch('/api/status');
      const j = await r.json();
      serverOk = !!j.ok;
      el.className = 'statuslight ' + (j.ok ? 'ok' : 'bad');
      el.querySelector('.txt').textContent = j.ok ? '相机就绪' : 'ComfyUI 未连接';
      if (!j.ok) toast('ComfyUI 未连接：请先启动 ComfyUI（默认 127.0.0.1:8000）', 'err', 7000);
    } catch (e) {
      el.className = 'statuslight bad';
      el.querySelector('.txt').textContent = '服务未启动';
      toast('后端服务未启动：请先运行 python server.py', 'err', 8000);
    }
  }

  async function loadGallery() {
    try {
      const r = await fetch('/api/gallery');
      const j = await r.json();
      GALLERY.replaceAll(j.items || []);
      frameNo = (j.items || []).length;
      $('frameCounter').textContent = String(frameNo).padStart(2, '0');
    } catch (e) { /* 离线也能用 */ }
  }

  function init() {
    VF.bindShakeKeyframes();
    VF.buildIris($('iris'));
    buildAll();
    bind();
    loadPreview(S.scene);
    $('evVal').textContent = '0.0 EV';
    update();

    // 补一下首屏选择态
    $('vfZebra').style.opacity = '0';

    loadGallery().then(checkServer);

    setTimeout(() => $('splash').classList.add('gone'), 900);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
