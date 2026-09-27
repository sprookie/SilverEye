/* ==========================================================================
   customgear.js —— 自定义相机机身
   ---------------------------------------------------------------------------
   思路：自定义机身最终要"变成" CATALOG.BODIES 里的一条普通记录，
   这样 engine.js / viewfinder.js / app.js 一行都不用改。
   所以这里做三件事：
     1. 把用户填的表单，翻译成一条完整的机身记录（含自定义画幅）
     2. 追加进 CATALOG.BODIES（并维护好内置条目的边界）
     3. 存 localStorage + 支持导出 / 导入 JSON
   ========================================================================== */
window.CUSTOMGEAR = (function () {
  'use strict';

  const KEY = 'silvereye.customBodies.v1';
  const BASE_COUNT = window.CATALOG.BODIES.length;   // 内置机身数量，追加时不能越界
  const FMT_PREFIX = 'cx_';                          // 自定义画幅的 key 前缀

  let list = load();
  const listeners = [];

  /* ------------------------------------------------------------ 存取 */
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(raw) ? raw.filter((x) => x && x.id) : [];
    } catch (e) {
      console.warn('自定义机身读取失败', e);
      return [];
    }
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch (e) {
      console.warn('自定义机身保存失败（可能是 localStorage 满了）', e);
    }
  }

  const slug = (s) => String(s || '')
    .trim().toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28) || 'body';

  function uid() {
    return 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ------------------------------------------------------------ 自动提示词签名
     用户往往不知道该写什么英文提示词，这里给一个可用的起点。
     关键：把"这是什么级别的机器"说清楚，模型才会给出对应的成像特征。 */
  function autoToken(def) {
    const fmt = fmtLabel(def);
    const kind = def.kind;
    if (kind === 'instant') {
      return `shot on a ${def.name} instant camera, integral instant film print, ` +
        `soft low-contrast tones, slight colour shift, visible white frame border`;
    }
    if (kind === 'film') {
      const grain = def.iso >= 800 ? 'visible film grain, pushed exposure' :
        def.iso <= 100 ? 'extremely fine grain, rich tonal gradation' : 'natural film grain';
      return `shot on a ${def.name}, ${fmt} film camera, ${grain}, ` +
        `authentic analogue rendering with gentle highlight rolloff`;
    }
    const era = def.gen === 'dslr' ? 'DSLR' : 'mirrorless';
    return `shot on a ${def.name} ${fmt} ${era} camera, clean digital capture, ` +
      (def.maxIso >= 25600 ? 'high dynamic range, modern sensor' : 'moderate dynamic range, classic sensor rendering');
  }

  /* 提示词是英文的，画幅名也必须给英文，否则会污染提示词 */
  const EN_FMT = {
    ff: '35mm', apsc: 'APS-C', mft: 'Micro Four Thirds',
    mf44: 'medium format', mf66: 'medium format 6x6', mf67: 'medium format 6x7',
    lf45: '4x5', phone: 'smartphone'
  };

  function fmtLabel(def) {
    if (def.format === 'custom') {
      const r = Math.round((def.ratio || 1.5) * 100) / 100;
      const names = { 1: 'square', 1.25: '5:4', 1.33: '4:3', 1.5: '3:2', 1.6: '16:10', 1.78: '16:9', 2: '2:1' };
      return names[r] ? `${names[r]} format` : `${def.sensorW}mm-wide custom format`;
    }
    return EN_FMT[def.format] || '35mm';
  }

  /* ------------------------------------------------------------ 翻译成机身记录 */
  function customFormat(def) {
    if (def.format !== 'custom') {
      const base = window.CATALOG.FORMATS[def.format];
      return { key: def.format, fmt: base };
    }
    // 自定义画幅：由感光面宽 + 画幅比推出高度，弥散圈换算成"画幅对角线/1730"
    // （这是业界常用的经验公式 c ≈ d/1500 ~ d/1730，与 CATALOG 里内置值基本吻合）
    const w = Math.max(4, Math.min(300, +def.sensorW || 36));
    const ratio = Math.max(0.5, Math.min(3, +def.ratio || 1.5));
    const diag = Math.hypot(w, w / ratio);
    const key = FMT_PREFIX + def.id;
    return {
      key,
      fmt: {
        label: `${def.cn || def.name} 画幅 ${w}×${(w / ratio).toFixed(1)}mm`,
        c: +def.coc > 0 ? +def.coc : +(diag / 1730).toFixed(4),
        sensorW: w,
        ratio,
        custom: true
      }
    };
  }

  function toEntry(def) {
    const { key, fmt } = customFormat(def);
    def._formatKey = key;
    return {
      id: def.id,
      name: def.name || def.cn || 'Custom Camera',
      cn: def.cn || def.name || '自定义机型',
      grip: def.grip || 'slr',
      format: key,
      kind: def.kind,
      gen: def.gen,
      maxIso: +def.maxIso || 3200,
      baseIso: +def.baseIso || 100,
      minShutter: +def.minShutter || 1 / 4000,
      maxShutter: +def.maxShutter || 1,
      token: (def.token || '').trim() || autoToken(def),
      trait: def.trait || '你自己定义的机身',
      custom: true,
      manual: def.kind !== 'digital',
      advance: def.kind === 'instant' ? 'auto' : (def.advance || 'lever'),
      instant: def.kind === 'instant',
      fixedAperture: +def.fixedAperture > 0 ? +def.fixedAperture : undefined,
      waistLevel: !!def.waistLevel,
      ffmt: fmt
    };
  }

  /* ------------------------------------------------------------ 同步进 CATALOG */
  function sync() {
    const C = window.CATALOG;

    // 1) 清掉上次追加的自定义画幅（内置的绝不动）
    Object.keys(C.FORMATS).forEach((k) => { if (k.indexOf(FMT_PREFIX) === 0) delete C.FORMATS[k]; });

    // 2) 截回内置长度，再追加
    C.BODIES.length = BASE_COUNT;
    list.forEach((def) => {
      const entry = toEntry(def);
      C.FORMATS[entry.format] = entry.ffmt;
      delete entry.ffmt;
      C.BODIES.push(entry);
    });
  }

  /* ------------------------------------------------------------ 增删改 */
  function save(def) {
    const clean = Object.assign({}, def);
    if (!clean.id) clean.id = uid();
    if (!clean.name) clean.name = clean.cn || 'Custom Camera';
    if (!clean.cn) clean.cn = clean.name;
    const i = list.findIndex((x) => x.id === clean.id);
    if (i >= 0) list[i] = clean; else list.push(clean);
    persist(); sync(); emit();
    return clean;
  }

  function remove(id) {
    list = list.filter((x) => x.id !== id);
    persist(); sync(); emit();
  }

  function duplicate(id) {
    const src = list.find((x) => x.id === id);
    if (!src) return null;
    const copy = Object.assign({}, src, { id: uid(), cn: src.cn + ' 副本', name: src.name + ' Copy' });
    list.push(copy); persist(); sync(); emit();
    return copy;
  }

  function get(id) { return list.find((x) => x.id === id); }
  function all() { return list.slice(); }
  function isCustom(id) { return String(id || '').startsWith('custom_'); }

  function emit() { listeners.forEach((fn) => { try { fn(list); } catch (e) { console.warn(e); } }); }
  function onChange(fn) { listeners.push(fn); }

  /* ------------------------------------------------------------ 导入导出 */
  function exportJSON() {
    return JSON.stringify({ v: 1, bodies: list }, null, 2);
  }

  function importJSON(text) {
    const d = JSON.parse(text);
    const arr = Array.isArray(d) ? d : (d.bodies || []);
    if (!Array.isArray(arr)) throw new Error('JSON 里没有 bodies 数组');
    let n = 0;
    arr.forEach((def) => {
      if (!def || typeof def !== 'object') return;
      const clean = Object.assign({}, def);
      clean.id = uid();                       // 重新发号，避免和现有冲突
      if (!clean.name) clean.name = clean.cn || 'Imported Camera';
      if (!clean.cn) clean.cn = clean.name;
      list.push(clean); n++;
    });
    persist(); sync(); emit();
    return n;
  }

  /* ------------------------------------------------------------ 模板 */
  function blank() {
    return {
      id: '', name: 'My Camera', cn: '我的相机',
      grip: 'slr', format: 'ff', kind: 'film', gen: 'vintage',
      baseIso: 100, maxIso: 3200,
      minShutter: 1 / 1000, maxShutter: 1,
      advance: 'lever', sensorW: 36, ratio: 1.5, coc: 0,
      token: '', trait: ''
    };
  }

  sync();

  /* ==========================================================================
     编辑器 UI
     ========================================================================== */
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let editing = null;         // 当前编辑的定义（null = 新建）
  let bound = false;
  let notify = null;

  function msg(text, kind) {
    const el = $('gearMsg');
    if (!el) return;
    el.textContent = text || '';
    el.style.display = text ? '' : 'none';
    el.style.borderColor = kind === 'err' ? 'rgba(255,77,67,.5)' : 'rgba(255,180,61,.3)';
  }

  function fillSelects() {
    const C = window.CATALOG;
    const fs = $('gFormat');
    const opts = Object.keys(C.FORMATS).filter((k) => k.indexOf(FMT_PREFIX) !== 0)
      .map((k) => `<option value="${k}">${esc(C.FORMATS[k].label)}</option>`).join('');
    fs.innerHTML = opts + '<option value="custom">—— 自定义画幅 ——</option>';

    const sh = C.SHUTTERS.map((s) => ({ t: s.t, label: s.label }));
    const mk = (id) => {
      $(id).innerHTML = sh.map((s) =>
        `<option value="${s.t}">${esc(s.label)}</option>`).join('');
    };
    mk('gMinShutter');
    mk('gMaxShutter');
  }

  function readForm() {
    const d = {
      id: editing && editing.id ? editing.id : '',
      cn: $('gCn').value.trim(),
      name: $('gName').value.trim(),
      kind: $('gKind').value,
      grip: $('gGrip').value,
      format: $('gFormat').value,
      advance: $('gAdvance').value,
      baseIso: +$('gBaseIso').value || 100,
      maxIso: +$('gMaxIso').value || 3200,
      minShutter: +$('gMinShutter').value || 1 / 1000,
      maxShutter: +$('gMaxShutter').value || 1,
      sensorW: +$('gSensorW').value || 36,
      ratio: +$('gRatio').value || 1.5,
      coc: +$('gCoc').value || 0,
      fixedAperture: +$('gFixedAp').value || undefined,
      waistLevel: $('gWaist').value === '1',
      trait: $('gTrait').value.trim(),
      token: $('gToken').value.trim()
    };
    d.gen = d.kind === 'digital' ? (d.grip === 'slr' ? 'dslr' : 'modern') : 'vintage';
    if (!d.name) d.name = d.cn || 'Custom Camera';
    if (!d.cn) d.cn = d.name;
    return d;
  }

  function writeForm(d) {
    $('gCn').value = d.cn || '';
    $('gName').value = d.name || '';
    $('gKind').value = d.kind || 'film';
    $('gGrip').value = d.grip || 'slr';
    $('gFormat').value = d.format && (d.format === 'custom' || window.CATALOG.FORMATS[d.format]) ? d.format : 'ff';
    $('gAdvance').value = d.advance || 'lever';
    $('gBaseIso').value = d.baseIso || 100;
    $('gMaxIso').value = d.maxIso || 3200;
    $('gMinShutter').value = String(d.minShutter || 1 / 1000);
    $('gMaxShutter').value = String(d.maxShutter || 1);
    $('gSensorW').value = d.sensorW || 36;
    $('gRatio').value = d.ratio || 1.5;
    $('gCoc').value = d.coc || '';
    $('gFixedAp').value = d.fixedAperture || '';
    $('gWaist').value = d.waistLevel ? '1' : '0';
    $('gTrait').value = d.trait || '';
    $('gToken').value = d.token || '';
    toggleCustomFmt();
  }

  const toggleCustomFmt = () => {
    const on = $('gFormat').value === 'custom';
    $('gCustomFmt').style.display = on ? '' : 'none';
  };

  function openEditor(id) {
    if (!bound) bindForm();
    editing = id ? get(id) : null;
    fillSelects();
    writeForm(editing ? Object.assign(blank(), editing) : blank());
    $('gearTitle').textContent = editing ? '编辑机型 · ' + editing.cn : '自定义机型';
    $('gearDelete').style.display = editing ? '' : 'none';
    msg('');
    $('gearModal').classList.add('on');
  }

  const closeEditor = () => $('gearModal').classList.remove('on');

  function bindForm() {
    if (bound) return;
    bound = true;

    $('gFormat').addEventListener('change', toggleCustomFmt);
    $('gearClose').addEventListener('click', closeEditor);
    $('gearModal').addEventListener('click', (e) => { if (e.target.id === 'gearModal') closeEditor(); });

    $('gAutoToken').addEventListener('click', () => {
      const d = readForm();
      $('gToken').value = autoToken(d);
      msg('已按当前选项生成签名，你可以再改。');
    });

    $('gearSave').addEventListener('click', () => {
      const d = readForm();
      if (!d.cn && !d.name) { msg('至少给它起个名字。', 'err'); return; }
      if (d.minShutter > d.maxShutter) { msg('最快快门不能比最慢快门还慢。', 'err'); return; }
      if (d.format === 'custom' && !(d.sensorW > 0 && d.ratio > 0)) {
        msg('自定义画幅要填感光面宽和画幅比。', 'err'); return;
      }
      const saved = save(d);
      closeEditor();
      if (notify) notify(saved);
    });

    $('gearDelete').addEventListener('click', () => {
      if (!editing) return;
      if (!confirm(`删除机型「${editing.cn}」？`)) return;
      const id = editing.id;
      remove(id);
      closeEditor();
      if (notify) notify(null, id);
    });

    $('gearExport').addEventListener('click', () => {
      const blob = new Blob([exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'silvereye-cameras.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      msg('已导出 ' + list.length + ' 台自定义机型。');
    });

    $('gearImport').addEventListener('click', () => $('gearFile').click());
    $('gearFile').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const n = importJSON(String(rd.result));
          msg(`导入成功，新增 ${n} 台机型。`);
          if (notify) notify(null, null);
        } catch (err) {
          msg('导入失败：' + err.message, 'err');
        }
      };
      rd.readAsText(f);
      e.target.value = '';
    });
  }

  function setNotify(fn) { notify = fn; }

  return {
    all, get, save, remove, duplicate, isCustom, onChange, sync,
    autoToken, fmtLabel, blank, exportJSON, importJSON, uid,
    openEditor, closeEditor, setNotify, FMT_PREFIX,
    get count() { return list.length; }
  };
})();
