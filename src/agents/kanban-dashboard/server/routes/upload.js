const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { asyncHandler } = require('../middleware/error-handler');
const taskService = require('../services/task-service');

const UPLOADS_DIR = path.join(__dirname, '../../data/uploads');
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = /image\/(jpeg|png|gif)|application\/pdf|text\/plain|application\/json/;

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const taskDir = path.join(UPLOADS_DIR, req.params.taskId || 'general');
    if (!fs.existsSync(taskDir)) {
      fs.mkdirSync(taskDir, { recursive: true });
    }
    cb(null, taskDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const id = crypto.randomBytes(8).toString('hex');
    cb(null, `${id}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  }
});

// POST /api/upload/:taskId
router.post('/upload/:taskId', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: true, message: 'No file uploaded' });
  }

  const attachment = {
    id: path.basename(req.file.filename, path.extname(req.file.filename)),
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    url: `/uploads/${req.params.taskId}/${req.file.filename}`,
    uploadedAt: new Date().toISOString()
  };

  const result = taskService.addAttachment(req.params.taskId, attachment);
  if (!result) {
    // Clean up orphan file
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: true, message: 'Task not found' });
  }

  res.status(201).json({ attachment });
}));

module.exports = router;
