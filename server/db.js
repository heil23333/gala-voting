'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'votes.db');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    performer TEXT NOT NULL DEFAULT '',
    cover_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL,
    voter_fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS vote_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voter_fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS awards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL,
    award_type TEXT NOT NULL,
    rank INTEGER,
    FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_votes_fp ON votes(voter_fingerprint);
  CREATE INDEX IF NOT EXISTS idx_votes_program ON votes(program_id);
  CREATE INDEX IF NOT EXISTS idx_vote_records_fp ON vote_records(voter_fingerprint);
`);

// 同一节目同一指纹仅一票：先清理历史重复行，再加唯一索引兜底
db.exec(`
  DELETE FROM votes
   WHERE id NOT IN (
     SELECT MIN(id) FROM votes GROUP BY program_id, voter_fingerprint
   );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_votes_program_fp
    ON votes(program_id, voter_fingerprint);
`);

const DEFAULT_SETTINGS = {
  voting_open: '0',
  max_votes_per_user: '3',
  rank_award_count: '3',
  admin_password: 'admin123',
  ended: '0',
};

const insertSetting = db.prepare(
  'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
);
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  insertSetting.run(key, value);
}

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function getSettingInt(key, fallback = 0) {
  const raw = getSetting(key);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

function getAllSettings() {
  return {
    votingOpen: getSetting('voting_open') === '1',
    ended: getSetting('ended') === '1',
    maxVotesPerUser: getSettingInt('max_votes_per_user', 3),
    rankAwardCount: getSettingInt('rank_award_count', 3),
    adminPassword: getSetting('admin_password', 'admin123'),
  };
}

function getPublicSettings() {
  const s = getAllSettings();
  return {
    votingOpen: s.votingOpen,
    ended: s.ended,
    maxVotesPerUser: s.maxVotesPerUser,
    rankAwardCount: s.rankAwardCount,
  };
}

function getProgramsWithVotes() {
  return db
    .prepare(
      `SELECT p.id, p.name, p.performer, p.cover_url, p.sort_order, p.created_at,
              COALESCE(v.vote_count, 0) AS vote_count
       FROM programs p
       LEFT JOIN (
         SELECT program_id, COUNT(*) AS vote_count
         FROM votes GROUP BY program_id
       ) v ON v.program_id = p.id
       ORDER BY p.sort_order ASC, p.id ASC`
    )
    .all();
}

function getRankings() {
  return db
    .prepare(
      `SELECT p.id, p.name, p.performer, p.cover_url, p.sort_order,
              COALESCE(v.vote_count, 0) AS vote_count
       FROM programs p
       LEFT JOIN (
         SELECT program_id, COUNT(*) AS vote_count
         FROM votes GROUP BY program_id
       ) v ON v.program_id = p.id
       ORDER BY vote_count DESC, p.sort_order ASC, p.id ASC`
    )
    .all();
}

function getTotalVoters() {
  const row = db
    .prepare('SELECT COUNT(DISTINCT voter_fingerprint) AS c FROM votes')
    .get();
  return row.c;
}

function getVoterVoteCount(fingerprint) {
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM votes WHERE voter_fingerprint = ?')
    .get(fingerprint);
  return row.c;
}

function getVoterVotedPrograms(fingerprint) {
  return db
    .prepare(
      'SELECT DISTINCT program_id FROM votes WHERE voter_fingerprint = ?'
    )
    .all(fingerprint)
    .map((r) => r.program_id);
}

function getAwards() {
  return db
    .prepare(
      `SELECT a.id, a.program_id, a.award_type, a.rank,
              p.name, p.performer, p.cover_url,
              COALESCE(v.vote_count, 0) AS vote_count
       FROM awards a
       JOIN programs p ON p.id = a.program_id
       LEFT JOIN (
         SELECT program_id, COUNT(*) AS vote_count
         FROM votes GROUP BY program_id
       ) v ON v.program_id = a.program_id
       ORDER BY
         CASE a.award_type WHEN 'rank' THEN 0 ELSE 1 END,
         COALESCE(a.rank, 999) ASC,
         vote_count DESC`
    )
    .all();
}

const insertVote = db.prepare(
  'INSERT OR IGNORE INTO votes (program_id, voter_fingerprint) VALUES (?, ?)'
);
const insertVoteRecord = db.prepare(
  'INSERT INTO vote_records (voter_fingerprint) VALUES (?)'
);
const insertFirstVoteRecord = db.prepare(
  `INSERT INTO vote_records (voter_fingerprint)
   SELECT ? WHERE NOT EXISTS (SELECT 1 FROM vote_records WHERE voter_fingerprint = ?)`
);

const insertProgram = db.prepare(
  `INSERT INTO programs (name, performer, cover_url, sort_order)
   VALUES (?, ?, ?, ?)`
);
const updateProgram = db.prepare(
  `UPDATE programs SET name = ?, performer = ?, cover_url = ? WHERE id = ?`
);
const deleteProgram = db.prepare('DELETE FROM programs WHERE id = ?');
const getProgram = db.prepare('SELECT * FROM programs WHERE id = ?');
const getMaxSort = db.prepare(
  'SELECT COALESCE(MAX(sort_order), 0) AS m FROM programs'
);
const updateSort = db.prepare(
  'UPDATE programs SET sort_order = ? WHERE id = ?'
);
const clearVotes = db.prepare('DELETE FROM votes');
const clearVoteRecords = db.prepare('DELETE FROM vote_records');
const clearAwards = db.prepare('DELETE FROM awards');
const clearPrograms = db.prepare('DELETE FROM programs');
const clearAllAwardsFor = db.prepare('DELETE FROM awards WHERE program_id = ?');
const insertAward = db.prepare(
  'INSERT INTO awards (program_id, award_type, rank) VALUES (?, ?, ?)'
);

const insertVotesTx = db.transaction((fingerprint, programIds) => {
  for (const pid of programIds) {
    insertVote.run(pid, fingerprint);
  }
  insertFirstVoteRecord.run(fingerprint, fingerprint);
});

const resetVotesTx = db.transaction((withPrograms) => {
  clearAwards.run();
  clearVotes.run();
  clearVoteRecords.run();
  if (withPrograms) {
    clearPrograms.run();
  }
});

const reorderTx = db.transaction((ids) => {
  ids.forEach((id, idx) => updateSort.run(idx, id));
});

const endVotingTx = db.transaction((rankCount) => {
  clearAwards.run();
  const rankings = getRankings();
  rankings.forEach((p, idx) => {
    if (idx < rankCount) {
      insertAward.run(p.id, 'rank', idx + 1);
    } else {
      insertAward.run(p.id, 'encouragement', null);
    }
  });
  setSetting('voting_open', '0');
  setSetting('ended', '1');
  return rankings;
});

function createProgram({ name, performer, cover_url = null, sort_order = null }) {
  const order =
    sort_order === null || sort_order === undefined
      ? getMaxSort.get().m + 1
      : sort_order;
  const info = insertProgram.run(name, performer || '', cover_url, order);
  return getProgram.get(info.lastInsertRowid);
}

function updateProgramById(id, { name, performer, cover_url }) {
  const existing = getProgram.get(id);
  if (!existing) return null;
  updateProgram.run(
    name ?? existing.name,
    performer ?? existing.performer,
    cover_url === undefined ? existing.cover_url : cover_url,
    id
  );
  return getProgram.get(id);
}

function deleteProgramById(id) {
  clearAllAwardsFor.run(id);
  return deleteProgram.run(id).changes > 0;
}

function submitVote(fingerprint, programIds) {
  insertVotesTx(fingerprint, programIds);
}

function resetData(withPrograms) {
  resetVotesTx(withPrograms);
}

function reorderPrograms(ids) {
  reorderTx(ids);
}

function endVotingAndAward(rankCount) {
  return endVotingTx(rankCount);
}

module.exports = {
  db,
  DATA_DIR,
  UPLOAD_DIR,
  DB_PATH,
  getSetting,
  getSettingInt,
  setSetting,
  getAllSettings,
  getPublicSettings,
  getProgramsWithVotes,
  getRankings,
  getTotalVoters,
  getVoterVoteCount,
  getVoterVotedPrograms,
  getAwards,
  getProgram,
  createProgram,
  updateProgramById,
  deleteProgramById,
  submitVote,
  resetData,
  reorderPrograms,
  endVotingAndAward,
};
