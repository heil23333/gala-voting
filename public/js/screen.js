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
      <div class="name"></div>
      <div class="performer"></div>
      <div class="score"><span class="num">0</span><small>票</small></div>
      <div class="bar-wrap">
        <div class="bar" style="width:0%"></div>
      </div>`;
    return {
      row,
      rank: row.querySelector('.rank'),
      name: row.querySelector('.name'),
      performer: row.querySelector('.performer'),
      num: row.querySelector('.num'),
      bar: row.querySelector('.bar'),
    };
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

    list.forEach((p, i) => {
      let refs = rowRefs.get(p.id);
      if (!refs) {
        refs = createRowRefs();
        rowRefs.set(p.id, refs);
      }
      seen.add(p.id);

      refs.row.className = `row${i < 3 ? ' hot' : ''}`;
      refs.row.dataset.id = String(p.id);
      refs.rank.className = `rank ${rankClass(i)}`;
      refs.rank.textContent = String(i + 1);
      refs.name.textContent = p.name || '';
      refs.performer.textContent = p.performer || '——';
      frag.appendChild(refs.row); // appendChild 会把已存在的行移动到新位置

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

    el.rows.appendChild(frag);

    // 先强制回流建立旧宽度，再改宽度 → 保证 transition 生效
    //（新节点从 0% 增长，已有节点平滑变化）
    void el.rows.offsetHeight;
    updates.forEach(({ refs, pct, count }) => {
      refs.bar.style.width = `${pct}%`;
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
