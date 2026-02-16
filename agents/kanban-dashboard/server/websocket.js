const { WebSocketServer } = require('ws');

let wss = null;
const clients = new Set();

function init(server) {
  wss = new WebSocketServer({ server, path: '/ws' });
  
  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[WS] Client connected (total: ${clients.size})`);
    
    // Send initial connection confirmation
    ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
    
    // Heartbeat
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    
    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[WS] Client disconnected (total: ${clients.size})`);
    });
    
    ws.on('error', (err) => {
      console.error('[WS] Client error:', err.message);
      clients.delete(ws);
    });
  });
  
  // Heartbeat check every 30s
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        clients.delete(ws);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
  
  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });
  
  console.log('[WS] WebSocket server initialized on /ws');
  return wss;
}

function broadcast(type, data) {
  if (!wss) return;
  
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  
  clients.forEach((ws) => {
    if (ws.readyState === 1) { // OPEN
      ws.send(message);
    }
  });
}

module.exports = { init, broadcast };
