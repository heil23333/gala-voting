/* 浏览器指纹：canvas + UA + screen 等特征哈希 */
(function (global) {
  'use strict';

  function collectSignals() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let canvasHash = 'no-canvas';
    try {
      canvas.width = 240;
      canvas.height = 60;
      ctx.textBaseline = 'top';
      ctx.font = '16px "Arial"';
      ctx.fillStyle = '#f60';
      ctx.fillRect(0, 0, 120, 28);
      ctx.fillStyle = '#069';
      ctx.fillText('annual-gala-fp:中文abc123!@#', 2, 18);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('annual-gala-fp:中文abc123!@#', 4, 24);
      canvasHash = canvas.toDataURL();
    } catch (_) {}

    const plugins = Array.from(navigator.plugins || [])
      .map((p) => p.name)
      .join(',');

    return {
      userAgent: navigator.userAgent || '',
      language: navigator.language || '',
      languages: (navigator.languages || []).join(',') || '',
      platform: navigator.platform || '',
      screen: `${screen.width}x${screen.height}x${screen.colorDepth}dpr${window.devicePixelRatio || 1}`,
      timezone: String(new Date().getTimezoneOffset()),
      timezoneName: (Intl && Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions().timeZone) || '',
      touch: navigator.maxTouchPoints || 0,
      hwConcurrency: navigator.hardwareConcurrency || 0,
      deviceMemory: navigator.deviceMemory || 0,
      plugins,
      canvas: canvasHash,
    };
  }

  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function hashSignals(signals) {
    const raw = JSON.stringify(signals) + '|' + getSalt();
    // 多段哈希降低碰撞
    const h1 = fnv1a(raw);
    const h2 = fnv1a(raw.split('').reverse().join(''));
    const h3 = fnv1a(h1 + '|' + raw.length + '|' + h2);
    return `fp_${h1}${h2}${h3}`;
  }

  // 每台设备一份随机盐（localStorage 持久化）：
  // 纯设备特征会让同型号、同系统的手机哈希完全相同而被误判为同一个人
  let salt = null;
  function getSalt() {
    if (salt) return salt;
    try {
      salt = localStorage.getItem('gala_fp_salt');
      if (!salt) {
        salt =
          (global.crypto && crypto.randomUUID && crypto.randomUUID()) ||
          Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14);
        localStorage.setItem('gala_fp_salt', salt);
      }
    } catch (_) {
      salt = '';
    }
    return salt;
  }

  let cached = null;

  function getFingerprint() {
    if (cached) return cached;
    const activeSalt = getSalt();
    try {
      cached = hashSignals(collectSignals());
    } catch (_) {
      cached = 'fp_' + fnv1a(navigator.userAgent + screen.width + '|' + activeSalt);
    }
    try {
      sessionStorage.setItem('gala_fp', JSON.stringify({ fp: cached, salt: activeSalt }));
    } catch (_) {}
    return cached;
  }

  // 优先读 session 缓存（与盐绑定校验），跨刷新稳定
  try {
    const saved = JSON.parse(sessionStorage.getItem('gala_fp') || 'null');
    if (
      saved &&
      typeof saved === 'object' &&
      saved.salt === getSalt() &&
      typeof saved.fp === 'string' &&
      saved.fp.startsWith('fp_') &&
      saved.fp.length <= 128
    ) {
      cached = saved.fp;
    }
  } catch (_) {}

  global.GalaFP = { get: getFingerprint };
})(window);
