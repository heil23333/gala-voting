(function () {
  'use strict';

  const TOKEN_KEY = 'gala_admin_token';
  const state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    programs: [],
    orderDirty: false,
    maxDirty: false,
    rankDirty: false,
    editingId: null,
    coverUrl: null,
    settings: null,
    results: { rankings: [], awards: [] },
  };

  const el = {
    loginView: document.getElementById('login-view'),
    appView: document.getElementById('app-view'),
    loginForm: document.getElementById('login-form'),
    password: document.getElementById('password'),
    progList: document.getElementById('prog-list'),
    resultBody: document.getElementById('result-body'),
    liveBadge: document.getElementById('live-badge'),
    statVoters: document.getElementById('stat-voters'),
    statCount: document.getElementById('stat-count'),
    modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modal-title'),
    programForm: document.getElementById('program-form'),
    pName: document.getElementById('p-name'),
    pPerformer: document.getElementById('p-performer'),
    pCoverFile: document.getElementById('p-cover-file'),
    coverPreview: document.getElementById('cover-preview'),
    maxVotes: document.getElementById('max-votes'),
    rankCount: document.getElementById('rank-count'),
    newPassword: document.getElementById('new-password'),
    settingsForm: document.getElementById('settings-form'),
    voteUrl: document.getElementById('vote-url'),
    btnSaveOrder: document.getElementById('btn-save-order'),
  };

  function authApi(path, options = {}) {
    return Gala.api(path, { ...options, token: state.token });
  }

  function showLogin() {
    el.loginView.classList.remove('hidden');
    el.appView.classList.add('hidden');
  }

  function showApp() {
    el.loginView.classList.add('hidden');
    el.appView.classList.remove('hidden');
    el.voteUrl.value = `${location.origin}/vote`;
    refreshAll();
  }

  function setToken(token) {
    state.token = token;
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }

  async function login(password) {
    const data = await Gala.api('/api/admin/login', {
      method: 'POST',
      body: { password },
    });
    setToken(data.token);
    showApp();
  }

  async function logout() {
    try {
      await authApi('/api/admin/logout', { method: 'POST' });
    } catch (_) {}
    setToken('');
    showLogin();
  }

  // ---------- programs ----------
  function renderPrograms() {
    if (!state.programs.length) {
      el.progList.innerHTML = '<div class="hint">暂无节目，点击下方添加</div>';
      return;
    }

    el.progList.innerHTML = state.programs
      .map((p, idx) => {
        const style = Gala.coverStyle(p);
        return `
          <div class="prog-item" draggable="true" data-id="${p.id}" data-index="${idx}">
            <div class="drag-handle" title="拖拽排序">⋮⋮</div>
            <div class="thumb" style="${style}"></div>
            <div class="prog-meta">
              <div class="n">${Gala.esc(p.name)}</div>
              <div class="p">${Gala.esc(p.performer || '未填写表演者')}</div>
              <div class="v">${p.vote_count || 0} 票 · 顺序 ${p.sort_order}</div>
            </div>
            <div class="row-actions">
              <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${p.id}">编辑</button>
              <button class="btn btn-danger btn-sm" data-act="del" data-id="${p.id}">删除</button>
            </div>
          </div>`;
      })
      .join('');

    bindDrag();
  }

  function bindDrag() {
    let dragId = null;
    const items = el.progList.querySelectorAll('.prog-item');

    items.forEach((item) => {
      item.addEventListener('dragstart', (e) => {
        dragId = Number(item.dataset.id);
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try {
          e.dataTransfer.setData('text/plain', String(dragId));
        } catch (_) {}
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        items.forEach((x) => x.classList.remove('drag-over'));
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        item.classList.add('drag-over');
      });
      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over');
      });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        const targetId = Number(item.dataset.id);
        if (!dragId || dragId === targetId) return;

        const from = state.programs.findIndex((p) => p.id === dragId);
        const to = state.programs.findIndex((p) => p.id === targetId);
        if (from < 0 || to < 0) return;

        const moved = state.programs.splice(from, 1)[0];
        state.programs.splice(to, 0, moved);
        state.orderDirty = true;
        el.btnSaveOrder.disabled = false;
        renderPrograms();
      });
    });
  }

  async function loadPrograms() {
    const data = await authApi('/api/programs');
    state.programs = data.programs || [];
    renderPrograms();
  }

  async function saveOrder() {
    const ids = state.programs.map((p) => p.id);
    await authApi('/api/admin/programs/order', {
      method: 'PUT',
      body: { ids },
    });
    state.orderDirty = false;
    el.btnSaveOrder.disabled = true;
    Gala.toast('排序已保存', 'ok');
    await loadPrograms();
  }

  function openModal(program) {
    state.editingId = program ? program.id : null;
    state.coverUrl = program ? program.cover_url || null : null;
    el.modalTitle.textContent = program ? '编辑节目' : '添加节目';
    el.pName.value = program ? program.name : '';
    el.pPerformer.value = program ? program.performer || '' : '';
    updateCoverPreview();
    el.modal.classList.add('show');
  }

  function closeModal() {
    el.modal.classList.remove('show');
    state.editingId = null;
    state.coverUrl = null;
    el.programForm.reset();
    updateCoverPreview();
  }

  function updateCoverPreview() {
    if (state.coverUrl) {
      el.coverPreview.style.backgroundImage = `url('${state.coverUrl}')`;
      el.coverPreview.textContent = '';
    } else {
      el.coverPreview.style.backgroundImage = '';
      el.coverPreview.textContent = '未选择图片';
    }
  }

  async function uploadCover(file) {
    const fd = new FormData();
    fd.append('image', file);
    const res = await fetch('/api/admin/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '上传失败');
    return data.url;
  }

  // ---------- settings / results ----------
  function renderStatus(stats) {
    const votingOpen = stats.votingOpen;
    const ended = stats.ended;
    if (ended) {
      el.liveBadge.className = 'badge badge-closed';
      el.liveBadge.innerHTML = '<span class="dot"></span>投票已结束';
    } else if (votingOpen) {
      el.liveBadge.className = 'badge badge-live';
      el.liveBadge.innerHTML = '<span class="dot"></span>投票进行中';
    } else {
      el.liveBadge.className = 'badge badge-wait';
      el.liveBadge.innerHTML = '<span class="dot"></span>未开始';
    }
    el.statVoters.textContent = String(stats.totalVoters || 0);
    el.statCount.textContent = String(state.programs.length || 0);
  }

  function awardLabel(a) {
    return a.award_type === 'rank' ? `第${a.rank}名` : '优秀节目奖';
  }

  function renderResults(results) {
    const awardMap = new Map((results.awards || []).map((a) => [a.program_id, a]));
    const rows = (results.rankings || state.programs || [])
      .slice()
      .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0) || a.id - b.id);

    if (!rows.length) {
      el.resultBody.innerHTML = '<tr><td colspan="5" class="hint">暂无节目</td></tr>';
      return;
    }

    el.resultBody.innerHTML = rows
      .map((p, i) => {
        const award = awardMap.get(p.id);
        const tag = award
          ? `<span class="award-tag ${award.award_type === 'rank' ? 'rank' : 'enc'}">${awardLabel(award)}</span>`
          : '—';
        return `
          <tr>
            <td>${i + 1}</td>
            <td>${Gala.esc(p.name)}</td>
            <td>${Gala.esc(p.performer || '')}</td>
            <td class="n">${p.vote_count || 0}</td>
            <td>${tag}</td>
          </tr>`;
      })
      .join('');
  }

  function fillSettings(s) {
    state.settings = s;
    // 管理员正在编辑的字段不覆写（实时广播不能打断正在填写的值）
    if (!state.maxDirty) el.maxVotes.value = s.maxVotesPerUser;
    if (!state.rankDirty) el.rankCount.value = s.rankAwardCount;
  }

  // 本地有未保存的拖拽排序时，用服务端数据合并（保留本地顺序，只更新字段/增删项）
  function mergePrograms(serverPrograms) {
    const byId = new Map(serverPrograms.map((p) => [p.id, p]));
    const merged = [];
    for (const p of state.programs) {
      const s = byId.get(p.id);
      if (s) {
        merged.push(s);
        byId.delete(p.id);
      }
    }
    for (const p of serverPrograms) {
      if (byId.has(p.id)) merged.push(p); // 新增的节目追加到末尾
    }
    return merged;
  }

  async function refreshAll() {
    try {
      const [programs, settings, results] = await Promise.all([
        authApi('/api/programs'),
        authApi('/api/admin/settings'),
        authApi('/api/admin/results'),
      ]);
      const serverPrograms = programs.programs || [];
      state.programs = state.orderDirty ? mergePrograms(serverPrograms) : serverPrograms;
      state.results = results;
      renderPrograms();
      fillSettings(settings);
      renderResults(results);
      renderStatus({
        votingOpen: settings.votingOpen,
        ended: settings.ended,
        totalVoters: results.totalVoters || 0,
      });
    } catch (err) {
      if (err.status === 401) {
        setToken('');
        showLogin();
        return;
      }
      Gala.toast(err.message || '加载失败', 'err');
    }
  }

  // ---------- events ----------
  el.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await login(el.password.value);
      el.password.value = '';
    } catch (err) {
      Gala.toast(err.message || '登录失败', 'err');
    }
  });

  document.getElementById('btn-logout').addEventListener('click', logout);
  document.getElementById('btn-add').addEventListener('click', () => openModal(null));
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  el.btnSaveOrder.addEventListener('click', () => {
    saveOrder().catch((e) => Gala.toast(e.message, 'err'));
  });

  el.progList.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const act = btn.dataset.act;
    const program = state.programs.find((p) => p.id === id);

    if (act === 'edit' && program) {
      openModal(program);
    } else if (act === 'del') {
      if (!confirm(`确认删除节目「${program ? program.name : ''}」？其投票记录也会被删除。`)) return;
      try {
        await authApi(`/api/admin/programs/${id}`, { method: 'DELETE' });
        Gala.toast('已删除', 'ok');
        await refreshAll();
      } catch (err) {
        Gala.toast(err.message, 'err');
      }
    }
  });

  el.pCoverFile.addEventListener('change', async () => {
    const file = el.pCoverFile.files && el.pCoverFile.files[0];
    if (!file) return;
    try {
      Gala.toast('上传中…', 'ok', 1200);
      const url = await uploadCover(file);
      state.coverUrl = url;
      updateCoverPreview();
      Gala.toast('封面上传成功', 'ok');
    } catch (err) {
      Gala.toast(err.message || '上传失败', 'err');
    } finally {
      el.pCoverFile.value = '';
    }
  });

  document.getElementById('btn-clear-cover').addEventListener('click', () => {
    state.coverUrl = null;
    updateCoverPreview();
  });

  el.programForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: el.pName.value.trim(),
      performer: el.pPerformer.value.trim(),
      cover_url: state.coverUrl,
    };
    if (!payload.name) return;
    try {
      if (state.editingId) {
        await authApi(`/api/admin/programs/${state.editingId}`, {
          method: 'PUT',
          body: payload,
        });
        Gala.toast('节目已更新', 'ok');
      } else {
        await authApi('/api/admin/programs', {
          method: 'POST',
          body: payload,
        });
        Gala.toast('节目已添加', 'ok');
      }
      closeModal();
      await refreshAll();
    } catch (err) {
      Gala.toast(err.message, 'err');
    }
  });

  el.settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      maxVotesPerUser: Number(el.maxVotes.value),
      rankAwardCount: Number(el.rankCount.value),
    };
    const pwd = el.newPassword.value.trim();
    if (pwd) body.adminPassword = pwd;
    try {
      await authApi('/api/admin/settings', { method: 'PUT', body });
      el.newPassword.value = '';
      state.maxDirty = false;
      state.rankDirty = false;
      Gala.toast('设置已保存', 'ok');
      await refreshAll();
    } catch (err) {
      Gala.toast(err.message, 'err');
    }
  });

  el.maxVotes.addEventListener('input', () => {
    state.maxDirty = true;
  });
  el.rankCount.addEventListener('input', () => {
    state.rankDirty = true;
  });

  document.getElementById('btn-start').addEventListener('click', async () => {
    if (!confirm('确认开始投票？大屏与投票页将进入投票状态。')) return;
    try {
      await authApi('/api/admin/voting/start', { method: 'POST' });
      Gala.toast('投票已开始', 'ok');
      await refreshAll();
    } catch (err) {
      Gala.toast(err.message, 'err');
    }
  });

  document.getElementById('btn-end').addEventListener('click', async () => {
    if (!confirm('确认结束投票？结束后将计算奖项并在大屏公布结果。')) return;
    try {
      await authApi('/api/admin/voting/end', { method: 'POST' });
      Gala.toast('投票已结束，结果已生成', 'ok');
      await refreshAll();
    } catch (err) {
      Gala.toast(err.message, 'err');
    }
  });

  document.getElementById('btn-copy-url').addEventListener('click', async () => {
    const text = el.voteUrl.value;
    try {
      await navigator.clipboard.writeText(text);
      Gala.toast('投票链接已复制', 'ok');
    } catch (_) {
      el.voteUrl.select();
      document.execCommand && document.execCommand('copy');
      Gala.toast('投票链接已复制', 'ok');
    }
  });

  document.getElementById('btn-export').addEventListener('click', () => {
    if (!state.token) return;
    fetch('/api/admin/export', {
      headers: { Authorization: `Bearer ${state.token}` },
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || '导出失败');
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `gala-results-${Date.now()}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        Gala.toast('CSV 已导出', 'ok');
      })
      .catch((err) => Gala.toast(err.message || '导出失败', 'err'));
  });

  document.getElementById('btn-refresh-result').addEventListener('click', async () => {
    try {
      const results = await authApi('/api/admin/results');
      state.results = results;
      renderResults(results);
      Gala.toast('结果已刷新', 'ok');
    } catch (err) {
      Gala.toast(err.message, 'err');
    }
  });

  async function doReset(withPrograms) {
    const msg = withPrograms
      ? '确认清空投票记录并删除全部节目？此操作不可恢复！'
      : '确认清空全部投票记录？节目将保留，此操作不可恢复！';
    if (!confirm(msg)) return;
    try {
      await authApi('/api/admin/reset', {
        method: 'POST',
        body: { clearPrograms: withPrograms },
      });
      Gala.toast('数据已重置', 'ok');
      await refreshAll();
    } catch (err) {
      Gala.toast(err.message, 'err');
    }
  }

  document.getElementById('btn-reset-votes').addEventListener('click', () => doReset(false));
  document.getElementById('btn-reset-all').addEventListener('click', () => doReset(true));

  Gala.connectWS({
    onMessage: (msg) => {
      if (
        msg &&
        (msg.type === 'update' ||
          msg.type === 'started' ||
          msg.type === 'ended' ||
          msg.type === 'reset')
      ) {
        refreshAll();
      }
    },
  });

  // boot
  if (state.token) {
    authApi('/api/admin/settings')
      .then(() => showApp())
      .catch(() => {
        setToken('');
        showLogin();
      });
  } else {
    showLogin();
  }
})();
