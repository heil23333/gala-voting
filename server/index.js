'use strict';

const path = require('path');
const express = require('express');
const http = require('http');

const db = require('./db');
const { initWebSocket } = require('./ws');
const { router } = require('./api');

const app = express();
const server = http.createServer(app);
initWebSocket(server);

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

app.use('/uploads', express.static(db.UPLOAD_DIR, { maxAge: '7d' }));
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.use('/api', router);

app.get('/', (_req, res) => {
  res.redirect('/vote');
});

app.get('/vote', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'vote.html'));
});

app.get('/screen', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'screen.html'));
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

// 端口被占用等错误给出友好提示（ws 会把 server 错误转发给 WSS，
// 因此 ws.js 里也挂了 error 监听，避免未捕获异常直接崩溃）
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用：请停止占用该端口的进程，或用 PORT=xxxx 换一个端口。`);
    process.exit(1);
  }
  console.error('服务器启动/运行错误:', err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`年会评选系统已启动: http://${HOST}:${PORT}`);
  console.log(`  投票页   /vote`);
  console.log(`  大屏页   /screen`);
  console.log(`  管理后台 /admin`);
});
