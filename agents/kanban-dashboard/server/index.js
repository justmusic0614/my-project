// Load environment variables from .env file
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const http = require('http');
const express = require('express');
const cors = require('cors');
const { errorHandler } = require('./middleware/error-handler');
const { init: initWebSocket } = require('./websocket');

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));

// API Routes
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api', require('./routes/upload'));
app.use('/api/agents', require('./routes/agents'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/llm-config', require('./routes/llm-config'));
app.use('/api/api-usage', require('./routes/api-usage'));
app.use('/api/ab-test', require('./routes/ab-test'));
app.use('/api/telegram', require('./routes/telegram'));
app.use('/api/search', require('./routes/search'));

// Serve uploaded files
const uploadsDir = path.join(__dirname, '../data/uploads');
app.use('/uploads', express.static(uploadsDir));

// Serve React SPA (production)
const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) {
      res.status(200).send('Kanban Dashboard - Run "npm run dashboard:build" to build the client.');
    }
  });
});

// Error handling
app.use(errorHandler);

// Create HTTP server and attach WebSocket
const server = http.createServer(app);
initWebSocket(server);

server.listen(PORT, HOST, () => {
  console.log(`[${new Date().toISOString()}] Kanban Dashboard server running at http://${HOST}:${PORT}`);
  console.log(`[${new Date().toISOString()}] WebSocket available at ws://${HOST}:${PORT}/ws`);
});

module.exports = { app, server };
