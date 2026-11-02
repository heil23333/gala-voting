/* 烟花 / 彩带 庆祝动画 */
(function (global) {
  'use strict';

  function createCelebration(canvas) {
    const ctx = canvas.getContext('2d');
    let w = 0;
    let h = 0;
    let running = false;
    let raf = 0;
    let confetti = [];
    let particles = [];
    let sparks = [];
    let startTs = 0;
    const duration = 12000;

    function resize() {
      w = canvas.width = window.innerWidth * (window.devicePixelRatio || 1);
      h = canvas.height = window.innerHeight * (window.devicePixelRatio || 1);
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function rand(min, max) {
      return min + Math.random() * (max - min);
    }

    function spawnConfetti(count) {
      const colors = ['#ff6b35', '#e63946', '#f4c15d', '#fff', '#ff8f5c', '#2ec4b6'];
      for (let i = 0; i < count; i++) {
        confetti.push({
          x: Math.random() * w,
          y: -20 - Math.random() * h * 0.3,
          vx: rand(-2, 2),
          vy: rand(2, 6),
          size: rand(6, 14),
          rot: rand(0, Math.PI * 2),
          vr: rand(-0.15, 0.15),
          color: colors[(Math.random() * colors.length) | 0],
          sway: rand(0.5, 2),
          t: Math.random() * 10,
        });
      }
    }

    function burst(x, y, hueBase) {
      const colors = [hueBase, hueBase + 30, hueBase + 60, 0, 45, 180];
      for (let i = 0; i < 70; i++) {
        const ang = (Math.PI * 2 * i) / 70 + Math.random() * 0.2;
        const sp = rand(3, 12);
        sparks.push({
          x,
          y,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          life: 1,
          decay: rand(0.012, 0.028),
          color: colors[(Math.random() * colors.length) | 0],
          size: rand(2, 4),
        });
      }
      for (let i = 0; i < 18; i++) {
        particles.push({
          x,
          y,
          vx: rand(-1.5, 1.5),
          vy: rand(-2.5, 0),
          life: 1,
          decay: 0.01,
          size: rand(20, 60),
          color: hueBase,
        });
      }
    }

    function frame(now) {
      if (!running) return;
      const elapsed = now - startTs;
      ctx.clearRect(0, 0, w, h);

      // fireworks
      if (elapsed < duration * 0.85) {
        if (Math.random() < 0.08) {
          burst(rand(w * 0.15, w * 0.85), rand(h * 0.15, h * 0.55), (Math.random() * 360) | 0);
        }
      }

      // glow particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        g.addColorStop(0, `hsla(${p.color}, 90%, 65%, ${0.18 * p.life})`);
        g.addColorStop(1, `hsla(${p.color}, 90%, 65%, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // sparks
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.08;
        s.vx *= 0.985;
        s.vy *= 0.985;
        s.life -= s.decay;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        ctx.fillStyle = `hsla(${s.color}, 95%, 70%, ${s.life})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size * s.life, 0, Math.PI * 2);
        ctx.fill();
      }

      // confetti
      if (confetti.length < 120 && elapsed < duration * 0.9) {
        spawnConfetti(4);
      }
      for (let i = confetti.length - 1; i >= 0; i--) {
        const c = confetti[i];
        c.t += 0.08;
        c.x += c.vx + Math.sin(c.t) * c.sway;
        c.y += c.vy;
        c.rot += c.vr;
        if (c.y > h + 30) {
          confetti.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.rot);
        ctx.fillStyle = c.color;
        ctx.fillRect(-c.size / 2, -c.size / 4, c.size, c.size / 2);
        ctx.restore();
      }

      if (elapsed < duration || confetti.length || sparks.length) {
        raf = requestAnimationFrame(frame);
      } else {
        running = false;
        ctx.clearRect(0, 0, w, h);
      }
    }

    function start() {
      resize();
      running = true;
      startTs = performance.now();
      confetti = [];
      particles = [];
      sparks = [];
      spawnConfetti(120);
      burst(w * 0.5, h * 0.35, 25);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
      cancelAnimationFrame(raf);
      confetti = [];
      particles = [];
      sparks = [];
      ctx.clearRect(0, 0, w, h);
    }

    window.addEventListener('resize', () => {
      if (running) resize();
    });

    return { start, stop, get running() { return running; } };
  }

  global.Celebration = { create: createCelebration };
})(window);
