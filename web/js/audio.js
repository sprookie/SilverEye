/* ==========================================================================
   audio.js —— 用 WebAudio 合成相机音效（不依赖任何音频文件）
   反光板 / 快门帘 / 过片 / 闪光灯充电 / 对焦合焦 都是纯合成。
   ========================================================================== */
window.CAMSOUND = (function () {
  'use strict';

  let ctx = null;
  let master = null;
  let enabled = false;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    return ctx;
  }

  /** 白噪声 buffer，做机械声的底料 */
  function noise(dur) {
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function burst(t0, dur, freq, q, gain, type) {
    const src = ctx.createBufferSource();
    src.buffer = noise(dur);
    const bp = ctx.createBiquadFilter();
    bp.type = type || 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.0012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  function tone(t0, dur, f0, f1, gain, type) {
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  const api = {
    get on() { return enabled; },

    enable(v) {
      enabled = !!v;
      if (enabled) {
        ensure();
        if (ctx && ctx.state === 'suspended') ctx.resume();
      }
      return enabled;
    },

    /** 单反/无反的一次完整释放：反光板 + 快门帘 */
    shutter(kind) {
      if (!enabled || !ensure()) return;
      const t = ctx.currentTime + 0.01;
      if (kind === 'slr') {
        tone(t, 0.055, 190, 60, 0.36, 'triangle');       // 反光板落下的闷响
        burst(t, 0.035, 2600, 1.1, 0.5);                  // 帘幕金属声
        burst(t + 0.045, 0.05, 1500, 0.8, 0.34);          // 第二帘
      } else if (kind === 'rangefinder') {
        burst(t, 0.03, 3200, 1.4, 0.42);
        tone(t + 0.02, 0.04, 900, 300, 0.16, 'triangle');
      } else if (kind === 'leaf') {
        burst(t, 0.028, 4200, 2.2, 0.36);
        burst(t + 0.025, 0.03, 3400, 2.0, 0.28);
      } else if (kind === 'tlr' || kind === 'view') {
        tone(t, 0.08, 150, 50, 0.42, 'triangle');
        burst(t + 0.02, 0.05, 1800, 0.7, 0.36);
      } else if (kind === 'instant') {
        burst(t, 0.06, 900, 0.5, 0.4, 'lowpass');
        tone(t + 0.05, 0.5, 120, 320, 0.16, 'sawtooth');  // 出片马达
        burst(t + 0.28, 0.09, 2400, 0.9, 0.26);
      } else {
        burst(t, 0.03, 3000, 1.2, 0.3);
      }
    },

    /** 电动过片 / 过片杆 */
    advance(kind) {
      if (!enabled || !ensure()) return;
      const t = ctx.currentTime + 0.02;
      if (kind === 'auto') {
        tone(t, 0.22, 210, 340, 0.16, 'sawtooth');
        burst(t + 0.2, 0.05, 1600, 1.0, 0.24);
      } else if (kind === 'crank') {
        for (let i = 0; i < 4; i++) burst(t + i * 0.075, 0.03, 2100, 1.4, 0.22);
        tone(t + 0.3, 0.1, 260, 150, 0.12, 'triangle');
      } else {
        for (let i = 0; i < 3; i++) burst(t + i * 0.055, 0.028, 2500, 1.5, 0.2);
      }
    },

    /** 闪光灯充电的高频啸叫 */
    flashCharge(dur) {
      if (!enabled || !ensure()) return;
      const t = ctx.currentTime + 0.01;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(4200, t);
      o.frequency.linearRampToValueAtTime(9800, t + (dur || 1.2));
      o.frequency.linearRampToValueAtTime(4200, t + (dur || 1.2) + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.014, t + 0.3);
      g.gain.linearRampToValueAtTime(0.0001, t + (dur || 1.2) + 0.5);
      o.connect(g).connect(master);
      o.start(t); o.stop(t + (dur || 1.2) + 0.6);
    },

    /** 闪光灯放电 */
    flashPop() {
      if (!enabled || !ensure()) return;
      const t = ctx.currentTime + 0.01;
      burst(t, 0.09, 700, 0.35, 0.44, 'lowpass');
      tone(t, 0.06, 900, 120, 0.2, 'square');
    },

    /** 合焦提示音 */
    focus(ok) {
      if (!enabled || !ensure()) return;
      const t = ctx.currentTime + 0.01;
      tone(t, 0.07, ok ? 1760 : 620, ok ? 1760 : 520, 0.1, 'sine');
    },

    /** 上弦 / 机械准备 */
    cock() {
      if (!enabled || !ensure()) return;
      const t = ctx.currentTime + 0.01;
      burst(t, 0.04, 1300, 0.9, 0.18);
    },

    beep() {
      if (!enabled || !ensure()) return;
      const t = ctx.currentTime + 0.01;
      tone(t, 0.09, 1046, 1046, 0.09, 'sine');
      tone(t + 0.11, 0.12, 1568, 1568, 0.08, 'sine');
    }
  };

  return api;
})();
