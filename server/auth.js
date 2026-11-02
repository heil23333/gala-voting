'use strict';

const crypto = require('crypto');
const { getAllSettings } = require('./db');

const sessions = new Map();

// 会话 12 小时过期，避免内存里的登录态无限期有效
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function createToken(password) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, {
    createdAt: Date.now(),
    passwordHash: crypto.createHash('sha256').update(password).digest(), // Buffer
  });
  return token;
}

function verifyToken(token) {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return false;
  }
  const current = crypto
    .createHash('sha256')
    .update(getAllSettings().adminPassword)
    .digest();
  const stored = Buffer.isBuffer(session.passwordHash)
    ? session.passwordHash
    : Buffer.from(String(session.passwordHash), 'hex');
  if (
    stored.length !== current.length ||
    !crypto.timingSafeEqual(stored, current)
  ) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function revokeToken(token) {
  sessions.delete(token);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (!verifyToken(token)) {
    return res.status(401).json({ error: '未登录或登录已失效' });
  }
  next();
}

module.exports = { createToken, verifyToken, revokeToken, requireAuth };
