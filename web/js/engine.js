/* ==========================================================================
   engine.js —— 提示词工程引擎 + 真实光学计算
   ---------------------------------------------------------------------------
   两个职责：
   1) assemble()  把 (场景 × 机身 × 镜头 × 光圈 × 快门 × 胶片 × 滤镜 × 手法 × 光位 × 构图)
                  组装成一段生图模型能吃的英文提示词，并给出逐段拆解供 UI 高亮。
   2) optics()    用真实光学公式算出视角 / 景深 / 超焦距 / 测光偏差 / 运动模糊像素，
                  让"教学"部分不是嘴上说说，而是真的算出来的。
   ========================================================================== */
window.ENGINE = (function () {
  'use strict';

  const C = window.CATALOG;

  const byId = (arr, id) => arr.find((x) => x.id === id) || arr[0];
  const byAperture = (f) => C.APERTURES.reduce((a, b) => (Math.abs(b.f - f) < Math.abs(a.f - f) ? b : a));
  const byShutter = (t) => C.SHUTTERS.reduce((a, b) => (Math.abs(Math.log(b.t) - Math.log(t)) < Math.abs(Math.log(a.t) - Math.log(t)) ? b : a));
  const byLens = (mm) => C.LENSES.reduce((a, b) => (Math.abs(b.mm - mm) < Math.abs(a.mm - mm) ? b : a));

  /* ---------------------------------------------------------------- 默认状态 */
  function defaultState() {
    return {
      scene: 'street-portrait',
      body: 'a7rv',
      lens: 85,
      lensMod: 'none',
      aperture: 1.8,
      shutter: 1 / 250,
      iso: 100,
      film: 'digital',
      filter: 'none',
      flash: 'none',
      technique: 'none',
      composition: 'thirds',
      dist: 3,
      evComp: 0,
      seed: -1
    };
  }

  /** 根据机身自动挑一套合理的初始参数（首次进入 / 载入配方时用） */
  function stateFor(sceneId, bodyId, prev) {
    const s = Object.assign(defaultState(), prev || {});
    const sc = byId(window.SCENES, sceneId);
    const bd = byId(C.BODIES, bodyId);
    s.scene = sceneId;
    s.body = bodyId;
    s.dist = sc.dist;
    s.iso = bd.kind === 'digital' ? bd.baseIso : (bd.instant ? bd.baseIso : 400);
    s.film = bd.kind === 'digital' ? 'digital' : (bd.instant ? 'sx70film' : 'portra400');
    s.aperture = bd.grip === 'phone' ? 1.8 : (bd.fixedAperture || 2.8);
    s.lens = bd.grip === 'phone' ? 8 : (bd.format === 'mf66' ? 80 : bd.format === 'lf45' ? 150 : 50);
    s.shutter = pickShutter(sc.ev, s.aperture, s.iso, bd, sc);
    return s;
  }

  /**
   * 只换机身：感光材料、镜头、光圈要跟着机身走（画幅变了），
   * 但手法 / 构图 / 滤镜 / 闪光 / 曝光补偿这些"创作决定"必须保留。
   */
  function switchBody(prev, bodyId) {
    const bd = byId(C.BODIES, bodyId);
    const s = Object.assign({}, prev);
    s.body = bodyId;
    s.iso = bd.kind === 'digital' ? bd.baseIso : (bd.instant ? bd.baseIso : 400);
    s.film = bd.kind === 'digital' ? 'digital'
      : (bd.instant ? (bd.id === 'instax' ? 'instaxfilm' : 'sx70film') : 'portra400');
    if (bd.fixedAperture) s.aperture = Math.min(32, bd.fixedAperture);
    else if (bd.grip === 'phone') s.aperture = 1.8;
    if (bd.grip === 'phone') s.lens = 8;
    else if (bd.format === 'mf66') s.lens = 80;
    else if (bd.format === 'lf45') s.lens = 150;
    else if (s.lens < 14) s.lens = 50;
    return s;
  }

  /** 只换场景：只动"离主体的距离"，其它一律保留用户的决定 */
  function switchScene(prev, sceneId) {
    const sc = byId(window.SCENES, sceneId);
    const s = Object.assign({}, prev);
    s.scene = sceneId;
    s.dist = sc.dist;
    return s;
  }

  /** 按测光算一个"正确曝光"的快门，方便新手起步 */
  function pickShutter(ev, f, iso, body, scene) {
    // 目标: log2(f²/t) - log2(iso/100) == 场景有效 EV
    const want = ev + Math.log2(iso / 100);
    let t = (f * f) / Math.pow(2, want);
    const minT = body ? body.minShutter : 1 / 8000;
    const maxT = body && body.kind === 'digital' ? Math.max(body.maxShutter, 30) : (body ? body.maxShutter : 30);
    t = Math.min(maxT, Math.max(minT, t));
    return byShutter(t).t;
  }

  /* 滤镜的减光档数（真实相机里它们就在镜头前面挡光） */
  const FILTER_STOPS = { none: 0, cpl: -1.5, nd6: -3, nd10: -10, gnd: -1, soft: -0.4, star: -0.3, ir: -3 };
  const filterStops = (id) => FILTER_STOPS[id] || 0;
  const evEffective = (sceneEv, filterId) => sceneEv + filterStops(filterId);

  /* ---------------------------------------------------------------- 光学计算 */
  function optics(s) {
    const sc = byId(window.SCENES, s.scene);
    const bd = byId(C.BODIES, s.body);
    const fmt = C.FORMATS[bd.format] || C.FORMATS.ff;
    const f = s.lens;
    const N = s.aperture;
    const c = fmt.c;
    const dist = Math.max(0.05, Number(s.dist) || sc.dist);

    // --- 视角 ---
    const fovH = 2 * Math.atan(fmt.sensorW / (2 * f)) * 180 / Math.PI;
    const fovV = 2 * Math.atan((fmt.sensorW / fmt.ratio) / (2 * f)) * 180 / Math.PI;
    const equiv = f * (36 / fmt.sensorW);           // 等效 135 焦距

    // --- 景深（单位 mm，最后转 m）---
    const d = dist * 1000;
    const H = (f * f) / (N * c) + f;                 // 超焦距
    const near = (d * (H - f)) / (H + d - 2 * f);
    const farRaw = d < H ? (d * (H - f)) / (H - d) : Infinity;
    const nearM = near / 1000;
    const farM = farRaw === Infinity ? Infinity : Math.min(farRaw / 1000, 1e6);
    const dofM = farM === Infinity ? Infinity : Math.max(0, farM - nearM);
    const hyperM = H / 1000;

    // --- 测光 ---
    // evSet = log2(N²/t) - log2(ISO/100)，衡量的是"这组参数挡掉了多少光"，
    // 所以数值越大 = 进光越少 = 画面越暗。
    // 正确曝光要求 evSet == 场景有效 EV（含滤镜减光）。
    // 因此 偏差 = 场景有效EV − evSet：>0 表示进光多于需要 → 过曝。
    const evSet = Math.log2((N * N) / s.shutter) - Math.log2(s.iso / 100);
    const evEff = evEffective(sc.ev, s.filter);
    const bias = evEff - evSet;                      // >0 过曝, <0 欠曝（单位：级）

    // --- 运动模糊（像素）---
    const pitch = fmt.sensorW / 1152;                // mm / px
    const subjectSpeed = sc.speed;
    const imgMove = (subjectSpeed * s.shutter * f) / dist;   // mm
    let subjPx = imgMove / pitch;
    const isPanning = s.technique === 'panning';
    if (isPanning) subjPx *= 0.08;                   // 摇拍：主体被"追住"
    if (s.technique === 'freeze') subjPx *= 0.15;

    // 手持抖动：快门慢于 1/等效焦距 就抖
    const handheld = s.shutter > 1 / Math.max(4, equiv);
    let shakePx = 0;
    if (handheld && !['longexp', 'startrail', 'lightpainting'].includes(s.technique)) {
      shakePx = Math.min(40, (s.shutter * Math.max(4, equiv) - 1) * 6) * (s.technique === 'icm' ? 3 : 1);
    }
    if (s.technique === 'icm') shakePx = Math.max(shakePx, 55);
    if (s.technique === 'zoom-burst') shakePx = Math.max(shakePx, 30);

    // 背景相对模糊（摇拍时最大）
    const bgPx = isPanning ? Math.max(subjPx, imgMove / pitch * 0.9) : Math.max(0, imgMove / pitch);

    // --- 颗粒 ---
    const fl = byId(C.FILMS, s.film);
    let grain = fl.grain + Math.max(0, Math.log2(s.iso / (fl.iso || 100)) * 0.12);
    if (bd.kind === 'digital') grain = Math.max(0, (Math.log2(s.iso / (bd.baseIso || 100)) - 4) * 0.07);
    grain = Math.min(1, grain);

    // --- 画面比例 ---
    const ratio = fmt.ratio;

    return {
      scene: sc, body: bd, format: fmt, film: fl,
      fovH, fovV, equiv,
      dof: { near: nearM, far: farM, total: dofM, hyperfocal: hyperM, infinite: farM === Infinity },
      exposure: {
        evSet, evScene: sc.ev, evEffective: evEff, filterStops: filterStops(s.filter), bias,
        verdict: Math.abs(bias) < 0.4 ? 'good' : bias > 0 ? 'over' : 'under',
        stops: Math.abs(bias)
      },
      motion: {
        subjectPx: subjPx, bgPx, shakePx, handheld,
        sharp: subjPx < 1.6 && shakePx < 2,
        speed: subjectSpeed
      },
      grain, ratio
    };
  }

  /* ---------------------------------------------------------------- 提示词 */
  /**
   * 组装提示词。返回：
   *   { positive, negative, segments:[{key,label,text}] }
   * segments 用于前端把提示词"拆开"显示，让用户看见每一格旋钮改了什么词。
   */
  function assemble(s, extra) {
    const sc = byId(window.SCENES, s.scene);
    const bd = byId(C.BODIES, s.body);
    const lens = byLens(s.lens);
    const ap = byAperture(s.aperture);
    const sh = byShutter(s.shutter);
    const fl = byId(C.FILMS, s.film);
    const seg = [];
    const push = (key, label, text) => { if (text) seg.push({ key, label, text: String(text).trim() }); };

    // 1. 主体与环境
    push('scene', '主体 / 环境', sc.prompt);

    // 2. 手法带来的画面效果
    const tech = byId(window.TECHNIQUES, s.technique);
    push('technique', '摄影手法', tech.token);

    // 3. 构图
    const comp = byId(window.COMPOSITIONS, s.composition);
    push('composition', '构图', comp.token);

    // 4. 镜头
    const mod = byId(C.LENSMODS, s.lensMod);
    const lensBits = [lens.token, framing(equivF(s.lens, bd.format))];
    if (mod.token) lensBits.push(mod.token);
    if (bd.format === 'lf45' || bd.format === 'mf67') lensBits.push(`${fmtName(bd.format)} large-format optical rendering`);
    push('lens', `镜头 ${s.lens}mm`, lensBits.join(', '));

    // 5. 光圈与景深
    push('aperture', `光圈 f/${fmtF(s.aperture)}`, ap.token);

    // 6. 快门与运动
    push('shutter', `快门 ${sh.label}`, sh.token);

    // 6b. 摄影师的曝光补偿（有意偏离测光表）
    if (s.evComp && Math.abs(s.evComp) >= 0.3) {
      const v = s.evComp;
      push('exposure', '曝光补偿', v > 0
        ? `deliberately overexposed by ${v.toFixed(1)} stops relative to the meter, brighter airy rendition with lifted shadows`
        : `deliberately underexposed by ${Math.abs(v).toFixed(1)} stops relative to the meter, darker moodier rendition with protected highlights`);
    }

    // 7. 感光材料
    const filmBits = [];
    if (fl.stock) filmBits.push(fl.token);
    else if (bd.kind === 'digital') filmBits.push('digital capture');
    if (fl.bw) filmBits.push('black and white photograph, monochrome, grayscale');
    if (fl.tone) filmBits.push(fl.tone);
    if (fl.iso) filmBits.push(`exposed at ISO ${fl.iso}`);
    push('film', fl.bw ? `黑白 · ${fl.cn}` : fl.cn, filmBits.join(', '));

    // 8. 光线
    const lightBits = [];
    const t = s.technique;
    if (['golden-hour', 'blue-hour', 'overcast', 'high-key', 'low-key', 'backlight', 'rimlight'].includes(t)) {
      // 已在 technique.token 里表达
    } else if (['rembrandt', 'butterfly', 'split', 'three-point', 'hard-light', 'soft-light', 'reflector'].includes(t)) {
      // 光位类，已表达
    } else {
      lightBits.push(sceneLight(sc));
    }
    push('light', '光线', lightBits.join(', '));

    // 9. 闪光
    const flash = byId(C.FLASHES, s.flash);
    push('flash', '闪光 / 补光', flash.token);

    // 10. 滤镜
    const filt = byId(C.FILTERS, s.filter);
    push('filter', '滤镜', filt.token);

    // 11. 机身签名
    push('body', '机身', bd.token);

    // 12. 画质收尾
    const quality = ['photorealistic', 'professional photograph', 'highly detailed', 'natural lighting', 'realistic textures'];
    if (fl.bw) quality.push('fine art monochrome');
    push('quality', '画质', quality.join(', '));

    // 13. 用户自定义追加
    if (extra && extra.trim()) push('extra', '自定义补充', extra.trim());

    const positive = seg.map((x) => x.text).join(', ');

    // ---- 负向 ----
    const neg = [
      'cartoon', 'illustration', 'anime', '3d render', 'cgi', 'painting', 'drawing', 'sketch',
      'watermark', 'text', 'signature', 'logo', 'username',
      'lowres', 'jpeg artifacts', 'blurry mess', 'deformed hands', 'extra fingers', 'mutated anatomy',
      'oversaturated hdr', 'plastic skin', 'waxy skin'
    ];
    if (fl.bw) neg.push('colour', 'colorful', 'saturated color', 'sepia tone');
    else neg.push('black and white', 'monochrome', 'grayscale');
    if (fl.stock) neg.push('digital cgi look', 'clean smartphone hdr');
    if (bd.kind === 'digital') neg.push('heavy film grain', 'dust and scratches');
    if (sh.motion === 'frozen' || s.technique === 'freeze') neg.push('motion blur', 'blurry subject');
    if (s.technique === 'silhouette') neg.push('fill light on subject', 'visible facial detail');
    if (s.technique !== 'longexp' && s.technique !== 'startrail') neg.push('double exposure ghosting');

    return { positive, negative: neg.join(', '), segments: seg };
  }

  function fmtName(fmtKey) {
    const m = { ff: '35mm', apsc: 'APS-C', mft: 'Micro Four Thirds', mf44: 'medium format', mf66: 'medium format 6x6', mf67: 'medium format 6x7', lf45: '4x5', phone: 'smartphone' };
    return m[fmtKey] || '35mm';
  }

  /** 把实际焦距折成 135 等效焦距（决定取景范围的是等效焦距，不是标称焦距） */
  function equivF(mm, fmtKey) {
    const fmt = C.FORMATS[fmtKey] || C.FORMATS.ff;
    return mm * (36 / fmt.sensorW);
  }

  /**
   * 「这算广角还是长焦」在提示词里必须翻译成一句取景描述，
   * 否则生图模型只会照抄 "50mm" 这个词，却按自己喜欢的构图出图。
   */
  function framing(eq) {
    if (eq <= 16) return 'extremely wide framing, the subject small within a vast environment, strong perspective stretch';
    if (eq <= 22) return 'very wide framing, the subject occupying a small part of a sweeping environmental view';
    if (eq <= 30) return 'wide environmental framing, the subject placed within its full surroundings';
    if (eq <= 40) return 'medium framing, subject and environment given roughly equal weight';
    if (eq <= 55) return 'standard framing, the subject filling about half the frame';
    if (eq <= 75) return 'medium-close framing, the subject dominating most of the frame';
    if (eq <= 100) return 'tight framing, the subject filling the frame with a clean compressed background';
    if (eq <= 160) return 'very tight framing, only the subject and a little context visible, heavily compressed depth';
    if (eq <= 300) return 'telephoto crop, the subject isolated and enlarged, background crushed into a flat blur';
    return 'extreme telephoto crop, the subject isolated and hugely magnified against a compressed background';
  }

  function sceneLight(sc) {
    const map = {
      '人像': 'soft directional portrait light modelling the face',
      '风光': 'natural landscape light with clear depth and atmospheric layering',
      '夜景': 'mixed artificial light sources at night, deep shadows, glowing highlights',
      '建筑': 'clean architectural light revealing form and material',
      '纪实': 'uncontrolled available light, honest documentary illumination',
      '运动': 'bright even stadium daylight',
      '自然': 'natural wildlife light, subject emerging from its environment',
      '微距': 'soft diffused light wrapping delicate detail',
      '静物': 'controlled studio-quality light on the subject',
      '生活': 'warm ambient light with soft window falloff'
    };
    return map[sc.cat] || 'natural light';
  }

  const fmtF = (f) => (f >= 10 ? String(Math.round(f)) : String(f).replace(/^0/, ''));

  /** 生成一个缩略图用的短描述（场景切换时给个视觉提示，不必生图） */
  function shortLabel(s) {
    const bd = byId(C.BODIES, s.body);
    const fl = byId(C.FILMS, s.film);
    return `${bd.cn} · ${s.lens}mm · f/${fmtF(s.aperture)} · ${byShutter(s.shutter).label} · ${fl.bw ? '黑白' : '彩色'}`;
  }

  /** 曝光三要素的等效级数（教学用）：光圈 → 快门 → ISO 各贡献多少档 */
  function exposureTriangle(s) {
    const ap = byAperture(s.aperture);
    const sh = byShutter(s.shutter);
    return {
      aperture: ap.stop,                    // 相对 f/1.0 的级数
      shutter: -Math.log2(sh.t),            // 相对 1s
      iso: Math.log2(s.iso / 100),
      isoValue: s.iso
    };
  }

  return { defaultState, stateFor, switchBody, switchScene, optics, assemble, shortLabel, exposureTriangle,
           byId, byAperture, byShutter, byLens, fmtF, pickShutter,
           evEffective, filterStops, FILTER_STOPS };
})();
