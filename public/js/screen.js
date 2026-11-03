(function () {
  'use strict';

  const state = {
    programs: [],
    totalVoters: 0,
    votingOpen: false,
    ended: false,
    awards: null,
    celebrated: false,
  };

  const el = {
    rows: document.getElementById('rows'),
    voters: document.getElementById('voters'),
    totalVotes: document.getElementById('total-votes'),
    status: document.getElementById('status-badge'),
    overlay: document.getElementById('award-overlay'),
    awardList: document.getElementById('award-list'),
    awardTitle: document.getElementById('award-title'),
    clock: document.getElementById('clock'),
    fx: document.getElementById('fx'),
  };

  const celebration = window.Celebration.create(el.fx);

  function tickClock() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    el.clock.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  setInterval(tickClock, 1000);
  tickClock();

  function totalVotes(list) {
    return list.reduce((s, p) => s + (p.vote_count || 0), 0);
  }

  function setStatus() {
    if (state.ended) {
      el.status.className = 'badge badge-closed';
      el.status.innerHTML = '<span class="dot"></span>投票已结束';
    } else if (state.votingOpen) {
      el.status.className = 'badge badge-live';
      el.status.innerHTML = '<span class="dot"></span>投票进行中';
    } else {
      el.status.className = 'badge badge-wait';
      el.status.innerHTML = '<span class="dot"></span>待开始';
    }
  }

  function rankClass(i) {
    if (i === 0) return 'r1 medal';
    if (i === 1) return 'r2 medal';
    if (i === 2) return 'r3 medal';
    return '';
  }

  // 行节点按节目 id 复用：票数变化时只改宽度/数字，
  // CSS transition 才能触发（整表 innerHTML 重建会让动画永不生效）
  const rowRefs = new Map();

  function createRowRefs() {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <div>
        <div class="rank"></div>
      </div>
      <div class="thumb"></div>
      <div class="name"><span></span></div>
      <div class="performer"><span></span></div>
      <div class="score"><span class="num">0</span><small>票</small></div>
      <div class="bar-wrap">
        <div class="bar" style="width:0%"></div>
      </div>`;
    return {
      row,
      rank: row.querySelector('.rank'),
      thumb: row.querySelector('.thumb'),
      coverUrl: undefined,
      nameBox: row.querySelector('.name'),
      performerBox: row.querySelector('.performer'),
      name: row.querySelector('.name span'),
      performer: row.querySelector('.performer span'),
      num: row.querySelector('.num'),
      bar: row.querySelector('.bar'),
    };
  }

  // 文字超出列宽时自动左右滚动展示（不超出则保持静止）。
  // 只在跨过阈值时切换 class，避免每次广播都重启动画
  function applyMarquee(box) {
    const inner = box.firstElementChild;
    if (!inner) return;
    const overflow = inner.scrollWidth - box.clientWidth;
    if (overflow > 0) {
      box.style.setProperty('--shift', `-${overflow + 16}px`);
      box.classList.add('marquee');
    } else {
      box.classList.remove('marquee');
    }
  }

  function renderRows() {
    const list = [...state.programs].sort((a, b) => {
      if ((b.vote_count || 0) !== (a.vote_count || 0)) {
        return (b.vote_count || 0) - (a.vote_count || 0);
      }
      return (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id;
    });

    const max = Math.max(1, ...list.map((p) => p.vote_count || 0));

    const seen = new Set();
    const frag = document.createDocumentFragment();
    const updates = [];

    // 只有顺序真的变化时才移动节点：appendChild 重挂会让行内动画从头重启。
    // rowRefs.size 不匹配说明有行待新建/删除，同样走全量重排
    const desiredIds = list.map((p) => String(p.id)).join(',');
    const currentIds = [...el.rows.children].map((c) => c.dataset.id).join(',');
    const orderChanged = desiredIds !== currentIds || rowRefs.size !== list.length;

    // FLIP 第一步：换序前记录各行当前屏幕位置（重排后反算位移做滑动）
    const firstTops = new Map();
    const newRows = [];
    if (orderChanged) {
      rowRefs.forEach((refs, id) => {
        if (refs.row.isConnected) firstTops.set(id, refs.row.getBoundingClientRect().top);
      });
    }

    list.forEach((p, i) => {
      let refs = rowRefs.get(p.id);
      if (!refs) {
        refs = createRowRefs();
        rowRefs.set(p.id, refs);
        newRows.push(refs.row);
      }
      seen.add(p.id);

      // className 每轮重设，但要保留进行中的动画 class，避免广播把动画打断
      const rowCls = ['row'];
      if (i < 3) rowCls.push('hot');
      if (refs.row.classList.contains('enter')) rowCls.push('enter');
      refs.row.className = rowCls.join(' ');
      refs.row.dataset.id = String(p.id);

      const rankCls = ['rank', rankClass(i)];
      if (refs.rank.classList.contains('pop')) rankCls.push('pop');
      refs.rank.className = rankCls.join(' ');
      // 名次变化时徽章弹跳（首次渲染为空串，不触发）
      const rankNo = String(i + 1);
      if (refs.rank.textContent && refs.rank.textContent !== rankNo) {
        refs.rank.classList.remove('pop');
        void refs.rank.offsetWidth; // 强制回流以重启动画
        refs.rank.classList.add('pop');
      }
      refs.rank.textContent = rankNo;
      refs.name.textContent = p.name || '';
      refs.performer.textContent = p.performer || '——';
      // 封面只在变化时重设（含从无到有/后台换图），平时零开销
      if (refs.coverUrl !== p.cover_url) {
        refs.coverUrl = p.cover_url;
        refs.thumb.style.cssText = Gala.coverStyle(p);
      }
      if (orderChanged) frag.appendChild(refs.row); // appendChild 会把已存在的行移动到新位置

      const pct = Math.max(2, ((p.vote_count || 0) / max) * 100);
      updates.push({ refs, pct, count: p.vote_count || 0 });
    });

    // 删除已被移除的节目
    rowRefs.forEach((refs, id) => {
      if (!seen.has(id)) {
        refs.row.remove();
        rowRefs.delete(id);
      }
    });

    if (orderChanged) el.rows.appendChild(frag);

    // FLIP 第二步：量出各行位移，反向平移锁回"原地"作为动画起点
    const flips = [];
    if (orderChanged) {
      list.forEach((p) => {
        const refs = rowRefs.get(p.id);
        const first = firstTops.get(p.id);
        if (!refs || first === undefined) return;
        const dy = first - refs.row.getBoundingClientRect().top;
        if (Math.abs(dy) >= 1) flips.push({ row: refs.row, dy });
      });
      flips.forEach(({ row, dy }) => {
        row.style.transition = 'none';
        row.style.transform = `translateY(${dy}px)`;
      });
    }
    // 新节目：淡入上浮（动画结束后摘掉 class）
    newRows.forEach((row) => {
      row.addEventListener('animationend', (e) => {
        if (e.target === row) row.classList.remove('enter');
      });
      row.classList.add('enter');
    });

    // 先强制回流建立旧宽度与位移起点，再改宽度 → 保证 transition 生效
    //（新节点从 0% 增长，已有节点平滑变化）
    void el.rows.offsetHeight;

    // FLIP 第三步：非线性缓出滑到新名次位置
    flips.forEach(({ row }) => {
      row.style.transition = 'transform 0.75s cubic-bezier(0.25, 1.1, 0.4, 1)';
      row.style.transform = '';
    });

    updates.forEach(({ refs, pct, count }) => {
      applyMarquee(refs.nameBox);
      applyMarquee(refs.performerBox);
      refs.bar.style.width = `${pct}%`;
      // 票数变化时数字脉冲一下（首次渲染 lastCount 为 undefined，不触发）
      if (refs.lastCount !== undefined && refs.lastCount !== count) {
        refs.num.classList.remove('bump');
        void refs.num.offsetWidth;
        refs.num.classList.add('bump');
      }
      refs.lastCount = count;
      Gala.animateNumber(refs.num, count, 700);
    });

    Gala.animateNumber(el.totalVotes, totalVotes(list), 700);
  }

  function applySnapshot(data) {
    if (data.programs) state.programs = data.programs;
    if (data.totalVoters !== undefined) state.totalVoters = data.totalVoters;
    if (data.votingOpen !== undefined) state.votingOpen = data.votingOpen;
    if (data.ended !== undefined) state.ended = data.ended;
    if (data.awards) state.awards = data.awards;

    Gala.animateNumber(el.voters, state.totalVoters, 600);
    setStatus();
    renderRows();

    if (state.ended && !state.celebrated) {
      showAwards();
    }
    if (state.ended && state.awards) {
      renderAwards(state.awards);
    }
  }

  function awardLabel(a) {
    return a.award_type === 'rank' ? `第 ${a.rank} 名` : '优秀节目奖';
  }

  function renderAwards(awards) {
    el.awardList.innerHTML = awards
      .map((a) => {
        const cls =
          a.award_type === 'rank' && a.rank <= 3 ? `rank-${a.rank}` : '';
        return `
          <div class="award-item ${cls}">
            <div class="award-label">${awardLabel(a)}</div>
            <div>
              <div class="n">${Gala.esc(a.name)}</div>
              <div class="p">${Gala.esc(a.performer || '')}</div>
            </div>
            <div class="v">${a.vote_count || 0}<small style="font-size:0.5em;color:var(--text-faint)"> 票</small></div>
          </div>`;
      })
      .join('');
  }

  function showAwards() {
    state.celebrated = true;
    if (state.awards) renderAwards(state.awards);
    el.overlay.classList.add('show');
    celebration.start();
  }

  async function load() {
    try {
      const [stats, programs, results] = await Promise.all([
        Gala.api('/api/stats'),
        Gala.api('/api/programs'),
        Gala.api('/api/results'),
      ]);
      applySnapshot({
        ...stats,
        programs: programs.programs || [],
        awards: results.awards && results.awards.length ? results.awards : null,
      });
    } catch (err) {
      console.error(err);
    }
  }

  Gala.connectWS({
    onMessage: (msg) => {
      if (!msg || !msg.data) return;
      if (msg.type === 'update' || msg.type === 'started') {
        if (msg.type === 'started') {
          state.ended = false;
          state.celebrated = false;
          state.awards = null;
          el.overlay.classList.remove('show');
          celebration.stop();
        }
        applySnapshot(msg.data);
      } else if (msg.type === 'ended') {
        applySnapshot({
          ...msg.data,
          votingOpen: false,
          ended: true,
        });
      } else if (msg.type === 'reset') {
        // 管理员重置数据：撤下颁奖弹层、清掉结束状态
        state.ended = false;
        state.celebrated = false;
        state.awards = null;
        el.overlay.classList.remove('show');
        celebration.stop();
        applySnapshot(msg.data);
      }
    },
    onStatus: (s) => {
      if (s === 'open') load();
    },
  });

  load();
})();
