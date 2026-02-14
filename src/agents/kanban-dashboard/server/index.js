// Load environment variables from .env file
require('dotenv').config({ path: '/Users/suweicheng/projects/my-project/.env' });

const express = require('express');
const cors = require('cors');
const path = require('path');
const { errorHandler } = require('./middleware/error-handler');

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

app.listen(PORT, HOST, () => {
  console.log(`[${new Date().toISOString()}] Kanban Dashboard server running at http://${HOST}:${PORT}`);
});

module.exports = app;
