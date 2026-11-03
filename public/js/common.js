/* 通用工具：API、Toast、数字动画、WebSocket */
(function (global) {
  'use strict';

  const Gala = {};

  Gala.api = async function api(path, options = {}) {
    const opts = {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    };
    if (opts.token) {
      opts.headers.Authorization = `Bearer ${opts.token}`;
      delete opts.token;
    }
    if (opts.body && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    if (!res.ok) {
      const msg = (data && data.error) || `请求失败 (${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  };

  Gala.toast = function toast(message, type = 'ok', duration = 2600) {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-8px)';
      el.style.transition = 'all 0.25s ease';
      setTimeout(() => el.remove(), 260);
    }, duration);
  };

  Gala.animateNumber = function animateNumber(el, to, duration = 600) {
    if (!el) return;
    const from = Number(el.dataset.value || el.textContent || 0) || 0;
    if (from === to) {
      el.textContent = String(to);
      el.dataset.value = String(to);
      return;
    }
    const start = performance.now();
    const diff = to - from;
    el.dataset.value = String(to);

    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = String(Math.round(from + diff * eased));
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = String(to);
    }
    requestAnimationFrame(tick);
  };

  Gala.formatTime = function formatTime(iso) {
    if (!iso) return '';
    return String(iso).replace('T', ' ').slice(0, 19);
  };

  Gala.connectWS = function connectWS({ onMessage, onStatus }) {
    let ws = null;
    let closed = false;
    let retry = 0;

    function open() {
      if (closed) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        retry = 0;
        if (onStatus) onStatus('open');
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (onMessage) onMessage(msg);
        } catch (_) {}
      };
      ws.onclose = () => {
        if (onStatus) onStatus('close');
        if (closed) return;
        retry = Math.min(retry + 1, 8);
        const delay = Math.min(1000 * 2 ** retry, 15000);
        setTimeout(open, delay);
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch (_) {}
      };
    }

    open();
    return {
      close() {
        closed = true;
        try {
          ws && ws.close();
        } catch (_) {}
      },
    };
  };

  Gala.esc = function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  Gala.coverStyle = function coverStyle(program) {
    if (program.cover_url) {
      return `background-image:url('${Gala.esc(program.cover_url)}');background-size:cover;background-position:center;`;
    }
    const name = program.name || '节目';
    // 稳定渐变 + 纹理光效（无图时的高级感占位）。
    // 色相收敛到红橙玫瑰暖色域，贴合主题，避免按名字哈希随机出大片蓝绿
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    const warm = [6, 16, 26, 36, 350, 340];
    const base = warm[h % warm.length];
    const h2 = (base + 24) % 360;
    const h3 = (base + 336) % 360;
    return (
      `background-image:` +
      `radial-gradient(120% 130% at 18% 12%, hsla(${h3} 75% 62% / 0.32), transparent 52%),` +
      `radial-gradient(90% 120% at 85% 88%, hsla(${h2} 70% 55% / 0.28), transparent 55%),` +
      `repeating-linear-gradient(118deg, transparent 0 26px, rgba(255,255,255,0.045) 26px 30px),` +
      `linear-gradient(145deg, hsl(${base} 52% 30%), hsl(${h2} 58% 18%));`
    );
  };

  global.Gala = Gala;
})(window);
