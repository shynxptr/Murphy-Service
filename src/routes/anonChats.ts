import crypto from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { requireAuth, type AuthenticatedRequest } from '../auth.js';
import { config } from '../config.js';
import {
  addAnonMessage,
  closeAnonSession,
  getAnonSessionInternalById,
  listAnonMessages,
  listAnonSessions,
  markAnonSessionRead,
  toPublicAnonSession,
} from '../db.js';
import { notifyAnonSessionClosed, sendAnonReplyToDiscord } from '../bot.js';
import { emitAnonMessage, emitAnonSessionUpdated } from '../realtime.js';
import type { MessageAttachment } from '../types.js';

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Format file hanya mendukung JPG, PNG, GIF, WEBP, dan PDF (maks 8MB).'));
  },
});

export const anonChatsRouter = Router();
anonChatsRouter.use(requireAuth);

// Always returns sanitized sessions WITHOUT discord_user_id!
anonChatsRouter.get('/', (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  res.json({ sessions: listAnonSessions(status) });
});

anonChatsRouter.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const internal = getAnonSessionInternalById(id);
  if (!internal) {
    res.status(404).json({ error: 'Sesi anonim tidak ditemukan.' });
    return;
  }
  const session = markAnonSessionRead(id) || toPublicAnonSession(internal);
  const messages = listAnonMessages(id);
  res.json({ session, messages });
});

anonChatsRouter.post(
  '/:id/messages',
  upload.array('files', 4),
  async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const internal = getAnonSessionInternalById(id);
    if (!internal) {
      res.status(404).json({ error: 'Sesi anonim tidak ditemukan.' });
      return;
    }
    if (internal.status === 'closed') {
      res.status(400).json({ error: 'Sesi anonim ini sudah ditutup.' });
      return;
    }

    const content = String(req.body.content || '').trim();
    const uploadedFiles = (req.files as Express.Multer.File[] | undefined) || [];
    if (!content && uploadedFiles.length === 0) {
      res.status(400).json({ error: 'Pesan atau lampiran tidak boleh kosong.' });
      return;
    }

    const attachments: MessageAttachment[] = uploadedFiles.map((f) => ({
      filename: f.filename,
      originalName: f.originalname,
      mimeType: f.mimetype,
      size: f.size,
      url: `/api/uploads/${f.filename}`,
    }));

    try {
      await sendAnonReplyToDiscord({ sessionId: id, content, attachments });
      const message = addAnonMessage({
        sessionId: id,
        senderType: 'admin',
        senderLabel: req.user!.name,
        content,
        attachments,
      });
      const updated = toPublicAnonSession(getAnonSessionInternalById(id) || internal);
      emitAnonMessage(updated, message);
      res.status(201).json({ session: updated, message });
    } catch (err: unknown) {
      res.status(500).json({
        error:
          err instanceof Error
            ? `Gagal mengirim balasan (kemungkinan DM member tertutup): ${err.message}`
            : 'Gagal mengirim balasan ke member anonim.',
      });
    }
  }
);

anonChatsRouter.post('/:id/close', async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const internal = getAnonSessionInternalById(id);
  if (!internal) {
    res.status(404).json({ error: 'Sesi anonim tidak ditemukan.' });
    return;
  }

  const closed = closeAnonSession(id);
  const sysMsg = addAnonMessage({
    sessionId: id,
    senderType: 'system',
    senderLabel: 'Sistem',
    content: `Sesi ditutup oleh ${req.user!.name}.`,
  });
  await notifyAnonSessionClosed(id);
  if (closed) {
    emitAnonMessage(closed, sysMsg);
    emitAnonSessionUpdated(closed);
  }
  res.json({ session: closed, message: sysMsg });
});

