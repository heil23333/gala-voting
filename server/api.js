'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const QRCode = require('qrcode');

const db = require('./db');
const { createToken, revokeToken, requireAuth } = require('./auth');
const { broadcast } = require('./ws');

const router = express.Router();

const uploadDir = db.UPLOAD_DIR;
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const safeExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)
      ? ext
      : '.png';
    cb(null, `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持 png/jpg/jpeg/gif/webp 图片'));
  },
});

function snapshot() {
  return {
    programs: db.getProgramsWithVotes(),
    totalVoters: db.getTotalVoters(),
    ...db.getPublicSettings(),
  };
}

// 票数变化等高频广播做 250ms 合流：几百人同时投票时避免给所有客户端
// 发送全量快照风暴（发送时才取快照，永远是最新状态）
const UPDATE_COALESCE_MS = 250;
let updateTimer = null;

function broadcastUpdate() {
  if (updateTimer) return;
  updateTimer = setTimeout(() => {
    updateTimer = null;
    broadcast({ type: 'update', data: snapshot() });
  }, UPDATE_COALESCE_MS);
}

// started / ended / reset 立即发送，并取消待发的 update（其快照会被本次覆盖）
function broadcastNow(message) {
  if (updateTimer) {
    clearTimeout(updateTimer);
    updateTimer = null;
  }
  broadcast(message);
}

function isValidFingerprint(fp) {
  return typeof fp === 'string' && fp.length >= 8 && fp.length <= 128;
}

// ---------- Public: programs / stats / vote ----------

router.get('/programs', (_req, res) => {
  res.json({ programs: db.getProgramsWithVotes() });
});

router.get('/stats', (_req, res) => {
  res.json({
    totalVoters: db.getTotalVoters(),
    ...db.getPublicSettings(),
  });
});

router.get('/results', (_req, res) => {
  const settings = db.getPublicSettings();
  res.json({
    rankings: db.getRankings(),
    awards: settings.ended ? db.getAwards() : [],
    totalVoters: db.getTotalVoters(),
    ...settings,
  });
});

// 投票页二维码（按当前请求的 Host 生成，局域网 IP 扫码即可进入 /vote）
router.get('/qr', async (req, res) => {
  try {
    const host = req.get('host') || 'localhost';
    const url = `${req.protocol}://${host}/vote`;
    const dataUrl = await QRCode.toDataURL(url, {
      margin: 1,
      width: 480,
      color: { dark: '#14080cff', light: '#faf0eaff' },
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.send(Buffer.from(dataUrl.split(',')[1], 'base64'));
  } catch (err) {
    console.error('qr generate failed', err);
    res.status(500).json({ error: '二维码生成失败' });
  }
});

router.get('/my-votes', (req, res) => {
  const fp = String(req.query.fingerprint || '');
  if (!isValidFingerprint(fp)) {
    return res.status(400).json({ error: '缺少有效指纹' });
  }
  res.json({
    votedProgramIds: db.getVoterVotedPrograms(fp),
    used: db.getVoterVoteCount(fp),
    max: db.getPublicSettings().maxVotesPerUser,
  });
});

router.post('/vote', (req, res) => {
  const { fingerprint, programIds } = req.body || {};
  const settings = db.getAllSettings();

  if (!isValidFingerprint(fingerprint)) {
    return res.status(400).json({ error: '缺少有效浏览器指纹' });
  }
  if (!settings.votingOpen || settings.ended) {
    return res.status(400).json({
      error: settings.ended ? '投票已结束' : '投票尚未开始',
    });
  }
  if (!Array.isArray(programIds) || programIds.length === 0) {
    return res.status(400).json({ error: '请至少选择一个节目' });
  }

  const ids = [...new Set(programIds.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) {
    return res.status(400).json({ error: '节目参数无效' });
  }
  if (ids.length > settings.maxVotesPerUser) {
    return res.status(400).json({ error: '一次提交的节目数量超过上限' });
  }

  const existing = new Set(db.getVoterVotedPrograms(fingerprint));
  for (const id of ids) {
    if (existing.has(id)) {
      return res.status(400).json({ error: '同一节目不可重复投票' });
    }
    if (!db.getProgram.get(id)) {
      return res.status(400).json({ error: '节目不存在' });
    }
  }

  const used = db.getVoterVoteCount(fingerprint);
  if (used + ids.length > settings.maxVotesPerUser) {
    return res.status(400).json({
      error: `每人最多可投 ${settings.maxVotesPerUser} 票，你还可投 ${Math.max(0, settings.maxVotesPerUser - used)} 票`,
    });
  }

  try {
    db.submitVote(fingerprint, ids);
  } catch (err) {
    console.error('vote write failed', err);
    return res.status(500).json({ error: '投票失败，请稍后重试' });
  }

  broadcastUpdate();
  res.json({
    ok: true,
    used: db.getVoterVoteCount(fingerprint), // 以库中实际票数为准
    max: settings.maxVotesPerUser,
    votedProgramIds: db.getVoterVotedPrograms(fingerprint),
  });
});

// ---------- Admin auth ----------

// 登录防爆破：同一 IP 15 分钟内最多失败 10 次
const loginFails = new Map(); // ip -> { count, resetAt }
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;

function loginFailRecord(ip) {
  if (loginFails.size > 10000) loginFails.clear(); // 防内存膨胀
  const now = Date.now();
  let rec = loginFails.get(ip);
  if (!rec || rec.resetAt < now) {
    rec = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    loginFails.set(ip, rec);
  }
  return rec;
}

router.post('/admin/login', (req, res) => {
  const { password } = req.body || {};
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  const rec = loginFailRecord(ip);
  if (rec.count >= LOGIN_MAX_FAILS) {
    return res
      .status(429)
      .json({ error: '尝试次数过多，请 15 分钟后再试' });
  }

  const settings = db.getAllSettings();
  const ok =
    typeof password === 'string' &&
    crypto.timingSafeEqual(
      crypto.createHash('sha256').update(password).digest(),
      crypto.createHash('sha256').update(settings.adminPassword).digest()
    );
  if (!ok) {
    rec.count += 1;
    return res.status(401).json({ error: '密码错误' });
  }
  rec.count = 0;
  const token = createToken(settings.adminPassword);
  res.json({ token, ...settings, adminPassword: undefined });
});

router.post('/admin/logout', requireAuth, (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  revokeToken(token);
  res.json({ ok: true });
});

router.get('/admin/settings', requireAuth, (_req, res) => {
  res.json(db.getAllSettings());
});

router.put('/admin/settings', requireAuth, (req, res) => {
  const body = req.body || {};
  if (body.maxVotesPerUser !== undefined) {
    const n = Number(body.maxVotesPerUser);
    if (!Number.isInteger(n) || n < 1 || n > 50) {
      return res.status(400).json({ error: '每人可投票数需为 1-50 的整数' });
    }
    db.setSetting('max_votes_per_user', n);
  }
  if (body.rankAwardCount !== undefined) {
    const n = Number(body.rankAwardCount);
    if (!Number.isInteger(n) || n < 0 || n > 20) {
      return res.status(400).json({ error: '名次奖名额需为 0-20 的整数' });
    }
    db.setSetting('rank_award_count', n);
  }
  if (body.adminPassword !== undefined) {
    const p = String(body.adminPassword);
    if (p.length < 4) {
      return res.status(400).json({ error: '管理密码至少 4 位' });
    }
    db.setSetting('admin_password', p);
  }
  broadcastUpdate();
  res.json(db.getAllSettings());
});

// ---------- Programs CRUD ----------

router.post('/admin/programs', requireAuth, (req, res) => {
  const { name, performer, cover_url } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: '节目名称不能为空' });
  }
  const program = db.createProgram({
    name: String(name).trim(),
    performer: String(performer || '').trim(),
    cover_url: cover_url || null,
  });
  broadcastUpdate();
  res.json({ program });
});

router.put('/admin/programs/order', requireAuth, (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids 必须为非空数组' });
  }
  db.reorderPrograms(ids.map(Number));
  broadcastUpdate();
  res.json({ ok: true, programs: db.getProgramsWithVotes() });
});

router.put('/admin/programs/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { name, performer, cover_url } = req.body || {};
  if (name !== undefined && !String(name).trim()) {
    return res.status(400).json({ error: '节目名称不能为空' });
  }
  const program = db.updateProgramById(id, {
    name: name === undefined ? undefined : String(name).trim(),
    performer: performer === undefined ? undefined : String(performer).trim(),
    cover_url,
  });
  if (!program) return res.status(404).json({ error: '节目不存在' });
  broadcastUpdate();
  res.json({ program });
});

router.delete('/admin/programs/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const ok = db.deleteProgramById(id);
  if (!ok) return res.status(404).json({ error: '节目不存在' });
  broadcastUpdate();
  res.json({ ok: true });
});

// ---------- Upload / voting control / results / reset / export ----------

router.post('/admin/upload', requireAuth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || '上传失败' });
    }
    if (!req.file) {
      return res.status(400).json({ error: '未收到图片文件' });
    }
    const url = `/uploads/${req.file.filename}`;
    res.json({ url });
  });
});

router.post('/admin/voting/start', requireAuth, (_req, res) => {
  db.setSetting('ended', '0');
  db.setSetting('voting_open', '1');
  broadcastNow({ type: 'started', data: snapshot() });
  res.json({ ok: true, ...db.getPublicSettings() });
});

router.post('/admin/voting/end', requireAuth, (_req, res) => {
  const settings = db.getAllSettings();
  db.endVotingAndAward(settings.rankAwardCount);
  const data = {
    ...snapshot(),
    awards: db.getAwards(),
    rankings: db.getRankings(),
  };
  broadcastNow({ type: 'ended', data });
  res.json({ ok: true, ...data });
});

router.get('/admin/results', requireAuth, (_req, res) => {
  res.json({
    rankings: db.getRankings(),
    awards: db.getAwards(),
    totalVoters: db.getTotalVoters(),
    ...db.getPublicSettings(),
  });
});

router.get('/admin/export', requireAuth, (_req, res) => {
  const rankings = db.getRankings();
  const awards = db.getAwards();
  const awardMap = new Map(awards.map((a) => [a.program_id, a]));

  const header = ['排名', '节目名称', '表演者', '票数', '奖项'];
  const rows = rankings.map((p, idx) => {
    const award = awardMap.get(p.id);
    let awardLabel = '';
    if (award) {
      awardLabel =
        award.award_type === 'rank' ? `第${award.rank}名` : '优秀节目奖';
    }
    return [
      idx + 1,
      p.name,
      p.performer || '',
      p.vote_count,
      awardLabel,
    ];
  });

  const escape = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const csv =
    '\uFEFF' +
    [header, ...rows].map((r) => r.map(escape).join(',')).join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="gala-results-${Date.now()}.csv"`
  );
  res.send(csv);
});

router.post('/admin/reset', requireAuth, (req, res) => {
  const clearPrograms = Boolean(req.body && req.body.clearPrograms);
  db.resetData(clearPrograms);
  db.setSetting('voting_open', '0');
  db.setSetting('ended', '0');
  // 用独立的 reset 事件通知三个页面清掉"已投/已结束"的本地残留状态
  broadcastNow({ type: 'reset', data: snapshot() });
  res.json({ ok: true, programs: db.getProgramsWithVotes() });
});

module.exports = { router, broadcastUpdate, snapshot };
