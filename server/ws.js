'use strict';

const { WebSocketServer } = require('ws');

let wss = null;

function initWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  // ws 会把底层 server 的 error 转发到这里，必须有监听者避免进程崩溃
  wss.on('error', (err) => {
    console.error('WebSocket 服务错误:', err.message);
  });

  wss.on('connection', (socket) => {
    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });
    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg && msg.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (_) {
        /* ignore malformed frames */
      }
    });
  });

  const interval = setInterval(() => {
    if (!wss) return;
    for (const client of wss.clients) {
      if (!client.isAlive) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, 30000);

  wss.on('close', () => clearInterval(interval));
  return wss;
}

function broadcast(message) {
  if (!wss) return;
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

module.exports = { initWebSocket, broadcast };
