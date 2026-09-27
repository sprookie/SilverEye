/* ==========================================================================
   providers.js —— 生图引擎设置（多厂商）
   ---------------------------------------------------------------------------
   支持的引擎：本地 Qwen(ComfyUI) / OpenRouter / OpenAI Images / Gemini·Imagen
              / 自定义（任意 OpenAI 兼容端点）
   ---------------------------------------------------------------------------
   密钥策略（默认最安全）：
     · 默认把密钥存到**服务端** providers.json（已 gitignore），前端只保留
       "有没有存过" 的标记，之后出图不再来回传密钥
     · 只有用户主动勾选「在本机浏览器记住」时才写 localStorage
   ========================================================================== */
window.ENGINEBOX = (function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const LS = 'silvereye.engine.v1';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let catalog = { providers: [], presets: [] };
  let active = 'comfy_qwen';
  let configs = {};
  let serverHas = {};          // provider id → bool（服务端是否已存密钥）
  let reach = {};              // preset id → true/false/undefined（实测连通性）
  let reachState = 'idle';     // idle | loading | done
  let ready = false;

  /* ------------------------------------------------------------ 存取 */
  function loadLocal() {
    try {
      const d = JSON.parse(localStorage.getItem(LS) || '{}');
      active = d.active || 'comfy_qwen';
      configs = d.configs || {};
    } catch (e) { configs = {}; }
  }

  function saveLocal() {
    const out = { active, configs: {} };
    Object.keys(configs).forEach((k) => {
      const c = Object.assign({}, configs[k]);
      if (!c._remember) delete c.api_key;      // 没勾选就不落盘
      delete c._remember;
      out.configs[k] = c;
    });
    try { localStorage.setItem(LS, JSON.stringify(out)); } catch (e) { /* 忽略 */ }
  }

  const provider = (id) => catalog.providers.find((p) => p.id === id) || catalog.providers[0] || {};
  const cfgOf = (id) => (configs[id] = configs[id] || {});

  /** 出图时发给服务端的引擎配置 */
  function payload() {
    const p = provider(active);
    const c = cfgOf(active);
    const out = { id: active };
    ['base_url', 'model', 'extra_json', 'quality', 'steps', 'cfg', 'unet', 'clip', 'vae'].forEach((k) => {
      if (c[k] !== undefined && c[k] !== '') out[k] = c[k];
    });
    if (!out.base_url && p.default_base) out.base_url = p.default_base;
    if (!out.model && p.default_model) out.model = p.default_model;
    // 有密钥就带上（可能是本次刚输入的）；没有就让服务端用它保存的那份
    if (c.api_key) out.api_key = c.api_key;
    return out;
  }

  function describe() {
    const p = provider(active);
    const c = cfgOf(active);
    const model = c.model || p.default_model || '';
    return {
      id: active, label: p.label || active, model,
      short: (p.label || '').replace(/（.*?）/g, '') + (model ? ' · ' + model.split('/').pop() : ''),
      caps: p.caps || {}, note: p.note || '', needsKey: !!(p.caps || {}).needs_key,
      hasKey: !!((cfgOf(active).api_key) || serverHas[active])
    };
  }

  /* ------------------------------------------------------------ 连通性探测
     "哪个服务能不能连上"取决于运行环境，不该写死在代码里。
     这里实测一次（服务端后台线程跑、缓存 10 分钟），
     谁跑这套代码就得到谁自己网络的真实结果。
     服务端接口永远立刻返回，探测没跑完时会带 loading:true，前端轮询几次即可。 */
  async function fetchReach(force) {
    reachState = 'loading';
    renderPresets();
    for (let i = 0; i < 8; i++) {
      try {
        const url = '/api/reachability' + (force && i === 0 ? '?refresh=1' : '');
        const j = await (await fetch(url)).json();
        reach = j.presets || {};
        if (!j.loading) { reachState = 'done'; break; }
      } catch (e) {
        reachState = 'idle';
        break;
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
    if (reachState === 'loading') reachState = Object.keys(reach).length ? 'done' : 'idle';
    renderPresets();
  }

  function dot(presetId) {
    if (reachState === 'loading') return ['var(--ink-3)', '检测中…'];
    const v = reach[presetId];
    if (v === true) return ['var(--green)', '当前网络实测可达'];
    if (v === false) return ['var(--red)', '当前网络连不上（可用代理，或直接把 Base URL 换成能访问的地址）'];
    return ['var(--ink-3)', '未检测'];
  }

  /* ------------------------------------------------------------ 渲染 */
  function renderPresets() {
    const el = $('enginePresets');
    if (!el) return;
    el.innerHTML = catalog.presets.map((x) => {
      const [color, tip] = dot(x.id);
      return `<button class="chip" data-pid="${esc(x.id)}" title="${esc(x.note)}\n${esc(tip)}">
        <span class="k" style="display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:5px;
          background:${color}"></span>${esc(x.label)}
      </button>`;
    }).join('');
    el.querySelectorAll('.chip').forEach((b) => {
      b.addEventListener('click', () => applyPreset(b.dataset.pid));
    });
    const st = $('reachState');
    if (st) {
      st.textContent = reachState === 'loading' ? '正在检测当前网络的连通性…'
        : reachState === 'done' ? '已按当前网络实测'
          : '尚未检测';
    }
  }

  function applyPreset(pid) {
    const ps = catalog.presets.find((x) => x.id === pid);
    if (!ps) return;
    active = ps.provider;
    const c = cfgOf(active);
    c.base_url = ps.base_url;
    c.model = ps.model;
    saveLocal(); render();
    const v = reach[pid];
    hint(v === false
      ? `已套用「${ps.label}」。注意：当前网络连不上这个地址 —— 可以配代理，或直接把 Base URL 改成你能访问的地址。`
      : `已套用「${ps.label}」，填上密钥即可`);
  }

  function renderProviders() {
    const el = $('engineList');
    if (!el) return;
    el.innerHTML = catalog.providers.map((p) => {
      const has = serverHas[p.id];
      return `<button class="engine-card${p.id === active ? ' on' : ''}" data-id="${esc(p.id)}">
        <div class="hd"><b>${esc(p.label)}</b>
          <span class="tag">${esc(p.vendor)}</span>
          ${has ? '<span class="tag ok">已存密钥</span>' : ''}</div>
        <div class="note">${esc(p.note)}</div>
        <div class="caps">
          <span class="${p.caps.negative ? 'y' : 'n'}">负向提示词</span>
          <span class="${p.caps.seed ? 'y' : 'n'}">随机种子</span>
          <span class="${p.caps.steps ? 'y' : 'n'}">步数/CFG</span>
        </div>
      </button>`;
    }).join('');
    el.querySelectorAll('.engine-card').forEach((b) => {
      b.addEventListener('click', () => { active = b.dataset.id; saveLocal(); render(); });
    });
  }

  function field(label, id, opts) {
    const o = opts || {};
    return `<div class="field">
      <label>${esc(label)}${o.hint ? ` <span class="hint-inline">${esc(o.hint)}</span>` : ''}</label>
      ${o.textarea
        ? `<textarea id="${id}" rows="${o.rows || 2}" placeholder="${esc(o.ph || '')}">${esc(o.value || '')}</textarea>`
        : `<input type="${o.type || 'text'}" id="${id}" value="${esc(o.value || '')}" placeholder="${esc(o.ph || '')}" ${o.list ? `list="${o.list}"` : ''} />`}
      ${o.datalist ? `<datalist id="${o.list}">${o.datalist.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}
    </div>`;
  }

  function renderForm() {
    const p = provider(active);
    const c = cfgOf(active);
    const f = p.fields || [];
    const box = $('engineForm');
    let h = '';

    if (f.includes('api_key')) {
      h += `<div class="field">
        <label>API Key <span class="hint-inline">${esc(p.key_hint || '')}</span></label>
        <input type="password" id="engKey" autocomplete="off" placeholder="${serverHas[active] ? '●●●●●● 已保存在服务端（留空即沿用）' : '粘贴密钥'}" value="${esc(c._remember ? (c.api_key || '') : '')}" />
        <label class="chk"><input type="checkbox" id="engRemember" ${c._remember ? 'checked' : ''} />
          <span>在本机浏览器记住（默认只存服务端，更安全）</span></label>
      </div>`;
    }
    if (f.includes('base_url')) {
      h += field('Base URL', 'engBase', {
        value: c.base_url || p.default_base, ph: p.default_base || 'https://…/v1',
        hint: '可指向自建 / 中转服务'
      });
    }
    if (f.includes('model')) {
      h += field('模型', 'engModel', {
        value: c.model || p.default_model, ph: p.default_model || '模型名',
        list: 'engModels', datalist: p.models || []
      });
    }
    if (f.includes('quality')) {
      h += `<div class="field"><label>画质</label>
        <select id="engQuality">
          ${['', 'low', 'medium', 'high', 'standard', 'hd'].map((q) =>
            `<option value="${q}"${(c.quality || '') === q ? ' selected' : ''}>${q || '默认'}</option>`).join('')}
        </select></div>`;
    }
    if (f.includes('steps')) {
      h += `<div class="row2">
        ${field('步数', 'engSteps', { value: c.steps || 25 })}
        ${field('CFG', 'engCfg', { value: c.cfg !== undefined ? c.cfg : 1.0 })}
      </div>`;
    }
    if (f.includes('unet')) {
      h += `<details class="adv"><summary>量化档位（改这三个文件名可切画质）</summary>
        ${field('UNET', 'engUnet', { value: c.unet || '', ph: 'qwen_image_2.1_int8_convrot.safetensors' })}
        ${field('CLIP', 'engClip', { value: c.clip || '', ph: 'qwen3vl_8b_int8_convrot.safetensors' })}
        ${field('VAE', 'engVae', { value: c.vae || '', ph: 'qwen_image_2.1_vae_bf16.safetensors' })}
      </details>`;
    }
    if (f.includes('extra_json')) {
      h += field('额外请求参数（JSON）', 'engExtra', {
        value: c.extra_json || '', ph: '{"seed": 42} 或 {"watermark": false}',
        textarea: true, hint: '会合并进请求体，用于厂商特有参数'
      });
    }
    box.innerHTML = h;

    // 存回内存
    const bind = (id, key, cast) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('input', () => {
        const v = el.value;
        cfgOf(active)[key] = cast ? cast(v) : v;
        saveLocal(); refreshHints();
      });
      if (el.tagName === 'SELECT') el.addEventListener('change', () => {
        cfgOf(active)[key] = el.value; saveLocal(); refreshHints();
      });
    };
    bind('engBase', 'base_url');
    bind('engModel', 'model');
    bind('engExtra', 'extra_json');
    bind('engQuality', 'quality');
    bind('engSteps', 'steps', (v) => (v === '' ? '' : +v));
    bind('engCfg', 'cfg', (v) => (v === '' ? '' : +v));
    bind('engUnet', 'unet');
    bind('engClip', 'clip');
    bind('engVae', 'vae');

    const key = $('engKey');
    if (key) key.addEventListener('input', () => {
      cfgOf(active).api_key = key.value.trim();
      if (!cfgOf(active)._remember) { saveLocal(); }
      refreshHints();
    });
    const rem = $('engRemember');
    if (rem) rem.addEventListener('change', () => {
      cfgOf(active)._remember = rem.checked;
      if (!rem.checked && !key.value) delete cfgOf(active).api_key;
      saveLocal();
    });
  }

  function refreshHints() {
    const d = describe();
    const caps = d.caps;
    const msgs = [];
    if (!caps.negative) msgs.push('该引擎不支持负向提示词，系统会自动把关键排除项折进正向提示词');
    if (!caps.seed) msgs.push('不支持固定种子，同一参数每次结果都会不同（重拍按钮会失效）');
    if (!caps.steps) msgs.push('步数 / CFG 对该引擎无效，已自动隐藏');
    if (caps.sizes && caps.sizes.length) {
      msgs.push('尺寸会吸附到该引擎允许的 ' + caps.sizes.map((s) => s.join('×')).join(' / '));
    }
    if (d.needsKey && !d.hasKey) msgs.push('还没填密钥，无法出图');
    const el = $('engineHint');
    if (el) el.innerHTML = msgs.map((m) => `<div class="hint-line">· ${esc(m)}</div>`).join('')
      || '<div class="hint-line ok">· 该引擎支持完整的负向提示词与种子</div>';
    const bar = $('engineNow');
    if (bar) bar.textContent = d.short;
  }

  function render() {
    renderPresets(); renderProviders(); renderForm(); refreshHints();
    const p = provider(active);
    const docs = $('engineDocs');
    if (docs) { docs.href = p.docs || '#'; docs.textContent = p.docs ? '官方文档 ↗' : ''; }
    const nm = $('engineName');
    if (nm) nm.textContent = p.label || active;
  }

  function hint(text) {
    const el = $('engineMsg');
    if (el) { el.textContent = text; el.style.display = text ? '' : 'none'; }
  }

  /* ------------------------------------------------------------ 动作 */
  async function probe() {
    const btn = $('btnProbe');
    if (btn) { btn.disabled = true; btn.textContent = '测试中…'; }
    hint('');
    try {
      const r = await fetch('/api/provider/probe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: active, config: payload() })
      });
      const j = await r.json();
      hint((j.ok ? '✅ ' : '❌ ') + (j.detail || ''));
      return j;
    } catch (e) {
      hint('❌ 请求失败：' + e.message);
      return { ok: false, detail: e.message };
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '测试连接'; }
    }
  }

  async function saveServer() {
    const c = cfgOf(active);
    const body = { active, providers: {} };
    // api_key: null 表示"保留服务端已有的"，避免留空时把已存的密钥冲掉
    body.providers[active] = {
      base_url: c.base_url || '', model: c.model || '',
      extra_json: c.extra_json || '', quality: c.quality || '',
      steps: c.steps === '' ? null : c.steps, cfg: c.cfg === '' ? null : c.cfg,
      unet: c.unet || '', clip: c.clip || '', vae: c.vae || '',
      api_key: c.api_key ? c.api_key : null
    };
    const r = await fetch('/api/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const j = await r.json();
    if (j.ok) {
      serverHas[active] = serverHas[active] || !!c.api_key;
      if (c.api_key) { c.api_key = ''; serverHas[active] = true; }   // 交给服务端保管
      const k = $('engKey'); if (k) k.value = '';
      saveLocal(); render();
      hint('✅ 已保存到服务端 providers.json（该文件已在 .gitignore 里，不会提交）');
    } else {
      hint('❌ 保存失败');
    }
  }

  /* ------------------------------------------------------------ 初始化 */
  async function init() {
    loadLocal();
    try {
      const [cat, conf] = await Promise.all([
        fetch('/api/providers').then((r) => r.json()),
        fetch('/api/config').then((r) => r.json())
      ]);
      catalog = cat;
      serverHas = {};
      Object.keys(conf.providers || {}).forEach((pid) => {
        serverHas[pid] = !!conf.providers[pid].has_key;
        const c = cfgOf(pid);
        ['base_url', 'model', 'extra_json', 'quality', 'steps', 'cfg', 'unet', 'clip', 'vae'].forEach((k) => {
          if (!c[k] && conf.providers[pid][k]) c[k] = conf.providers[pid][k];
        });
      });
      if (conf.active && !localStorage.getItem(LS)) active = conf.active;
      ready = true;
    } catch (e) {
      console.warn('引擎清单加载失败', e);
    }
    if (!catalog.providers.length) {
      catalog = {
        providers: [{ id: 'comfy_qwen', label: '本地 Qwen-Image 2.1', vendor: 'ComfyUI', note: '服务未就绪', caps: { negative: true, seed: true, steps: true }, fields: ['base_url'] }],
        presets: []
      };
      active = 'comfy_qwen';
    }
    if (!provider(active)) active = catalog.providers[0].id;
    saveLocal();
    render();
  }

  function open() {
    $('engineModal').classList.add('on');
    render();
    fetchReach(false);            // 打开面板时实测一次（服务端有缓存，几乎无开销）
  }
  function close() { $('engineModal').classList.remove('on'); }

  return { init, open, close, render, probe, saveServer, payload, describe, applyPreset,
           fetchReach,
           get active() { return active; }, set active(v) { active = v; saveLocal(); render(); },
           get ready() { return ready; } };
})();
