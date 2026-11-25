import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';

export const uploadsRouter = Router();

// Protected endpoint: only logged-in admins can view uploaded/downloaded media
uploadsRouter.get('/:filename', requireAuth, (req, res) => {
  const safeName = path.basename(String(req.params.filename || ''));
  const filePath = path.join(config.uploadsDir, safeName);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File tidak ditemukan.' });
    return;
  }

  res.sendFile(filePath);
});
