(function () {
  'use strict';

  const fingerprint = window.GalaFP.get();
  const state = {
    programs: [],
    selected: new Set(),
    voted: new Set(),
    used: 0,
    max: 3,
    votingOpen: false,
    ended: false,
    totalVoters: 0,
  };

  const el = {
    grid: document.getElementById('grid'),
    notice: document.getElementById('notice'),
    statusBadge: document.getElementById('status-badge'),
    voters: document.getElementById('voters'),
    used: document.getElementById('used'),
    quotaMax: document.getElementById('quota-max'),
    quotaMax2: document.getElementById('quota-max2'),
    selCount: document.getElementById('sel-count'),
    remain: document.getElementById('remain'),
    btnSubmit: document.getElementById('btn-submit'),
  };

  function setNotice() {
    const n = el.notice;
    n.className = 'notice';
    if (state.ended) {
      n.classList.add('closed');
      n.textContent = '投票已结束，感谢参与！最终结果见大屏公布。';
      n.classList.remove('hidden');
    } else if (!state.votingOpen) {
      n.classList.add('warn');
      n.textContent = '投票尚未开始，请稍候等待主持人宣布开始。';
      n.classList.remove('hidden');
    } else if (state.used >= state.max) {
      n.classList.add('ok');
      n.textContent = `你已用完全部 ${state.max} 票，感谢参与！`;
      n.classList.remove('hidden');
    } else {
      n.classList.add('hidden');
    }
  }

  function setStatusBadge() {
    if (state.ended) {
      el.statusBadge.className = 'badge badge-closed';
      el.statusBadge.innerHTML = '<span class="dot"></span>投票已结束';
    } else if (state.votingOpen) {
      el.statusBadge.className = 'badge badge-live';
      el.statusBadge.innerHTML = '<span class="dot"></span>投票进行中';
    } else {
      el.statusBadge.className = 'badge badge-wait';
      el.statusBadge.innerHTML = '<span class="dot"></span>待开始';
    }
  }

  function updateQuota() {
    const remain = Math.max(0, state.max - state.used - state.selected.size);
    el.selCount.textContent = String(state.selected.size);
    el.remain.textContent = String(remain);
    el.used.textContent = String(state.used);
    el.quotaMax.textContent = String(state.max);
    el.quotaMax2.textContent = String(state.max);
    el.voters.textContent = String(state.totalVoters);

    const canSubmit =
      state.votingOpen && !state.ended && state.selected.size > 0 && remain >= 0 && state.used < state.max;
    el.btnSubmit.disabled = !canSubmit;
  }

  function render() {
    setStatusBadge();
    setNotice();
    updateQuota();

    if (!state.programs.length) {
      el.grid.innerHTML = '<div class="empty">暂无节目</div>';
      return;
    }

    const disabled = !state.votingOpen || state.ended || state.used >= state.max;

    el.grid.innerHTML = state.programs
      .map((p) => {
        const voted = state.voted.has(p.id);
        const selected = state.selected.has(p.id);
        const classes = ['program-card'];
        if (voted) classes.push('voted');
        if (selected) classes.push('selected');
        if (disabled && !voted) classes.push('disabled');

        const tag = voted
          ? '<span class="tag done">已投票</span>'
          : selected
            ? '<span class="tag pick">已选</span>'
            : '';

        const coverText = `
          <div class="ph">
            <div class="t">${Gala.esc(p.name)}</div>
            <div class="p">${Gala.esc(p.performer || '——')}</div>
          </div>`;

        return `
          <article class="${classes.join(' ')}" data-id="${p.id}">
            ${tag}
            <div class="cover" style="${Gala.coverStyle(p)}">
              <div class="veil"></div>
              ${coverText}
            </div>
            <div class="body">
              <h3>${Gala.esc(p.name)}</h3>
              <div class="performer">${Gala.esc(p.performer || '未填写表演者')}</div>
              <div class="stats">
                <div class="votes"><span class="n">${p.vote_count}</span><span class="u">票</span></div>
              </div>
            </div>
          </article>`;
      })
      .join('');
  }

  el.grid.addEventListener('click', (e) => {
    const card = e.target.closest('.program-card');
    if (!card) return;
    const id = Number(card.dataset.id);
    if (!Number.isInteger(id)) return;

    if (!state.votingOpen || state.ended) {
      Gala.toast(state.ended ? '投票已结束' : '投票尚未开始', 'err');
      return;
    }
    if (state.voted.has(id)) {
      Gala.toast('该节目你已投过票', 'err');
      return;
    }
    if (state.selected.has(id)) {
      state.selected.delete(id);
    } else {
      const remain = state.max - state.used - state.selected.size;
      if (remain <= 0) {
        Gala.toast(`每人最多投 ${state.max} 票`, 'err');
        return;
      }
      state.selected.add(id);
    }
    render();
  });

  el.btnSubmit.addEventListener('click', async () => {
    if (!state.selected.size) return;
    el.btnSubmit.disabled = true;
    el.btnSubmit.textContent = '提交中…';
    try {
      const data = await Gala.api('/api/vote', {
        method: 'POST',
        body: {
          fingerprint,
          programIds: [...state.selected],
        },
      });
      state.used = data.used;
      state.voted = new Set(data.votedProgramIds || []);
      state.selected.clear();
      Gala.toast('投票成功，感谢参与！', 'ok');
      await refresh(false);
    } catch (err) {
      Gala.toast(err.message || '投票失败', 'err');
      await refresh(false);
    } finally {
      el.btnSubmit.textContent = '提交投票';
      updateQuota();
    }
  });

  async function refresh(showError) {
    try {
      const [stats, programs, mine] = await Promise.all([
        Gala.api('/api/stats'),
        Gala.api('/api/programs'),
        Gala.api(`/api/my-votes?fingerprint=${encodeURIComponent(fingerprint)}`),
      ]);
      state.votingOpen = stats.votingOpen;
      state.ended = stats.ended;
      state.max = stats.maxVotesPerUser || 3;
      state.totalVoters = stats.totalVoters || 0;
      state.programs = programs.programs || [];
      state.voted = new Set(mine.votedProgramIds || []);
      state.used = mine.used || 0;
      render();
    } catch (err) {
      if (showError) Gala.toast(err.message || '加载失败', 'err');
    }
  }

  Gala.connectWS({
    onMessage: (msg) => {
      if (!msg || !msg.data) return;
      if (msg.type === 'reset') {
        // 管理员重置数据：清空本地选择，重新拉取“我已投”状态
        state.selected.clear();
        refresh(false);
        return;
      }
      if (msg.type === 'update' || msg.type === 'started' || msg.type === 'ended') {
        if (msg.data.programs) state.programs = msg.data.programs;
        state.totalVoters = msg.data.totalVoters ?? state.totalVoters;
        state.votingOpen = msg.data.votingOpen ?? state.votingOpen;
        state.ended = msg.data.ended ?? state.ended;
        if (msg.type === 'ended') {
          state.votingOpen = false;
          state.ended = true;
        }
        if (msg.type === 'started') {
          state.ended = false;
          state.votingOpen = true;
        }
        render();
      }
    },
    onStatus: (s) => {
      if (s === 'open') refresh(false);
    },
  });

  refresh(true);
})();
