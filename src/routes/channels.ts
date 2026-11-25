import crypto from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { requireAuth, type AuthenticatedRequest } from '../auth.js';
import { config } from '../config.js';
import { addChannelPost, listChannelPosts, logAudit } from '../db.js';
import { listGuildTextChannels, sendMessageToChannel } from '../bot.js';
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
    if (ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Format file hanya mendukung JPG, PNG, GIF, WEBP, dan PDF (maks 8MB).'));
    }
  },
});

export const channelsRouter = Router();
channelsRouter.use(requireAuth);

channelsRouter.get('/', async (_req, res) => {
  const channels = await listGuildTextChannels();
  res.json({ channels });
});

channelsRouter.get('/history', (_req, res) => {
  res.json({ posts: listChannelPosts() });
});

channelsRouter.post(
  '/send',
  upload.array('files', 4),
  async (req: AuthenticatedRequest, res) => {
    const channelId = String(req.body.channel_id || '').trim();
    const content = String(req.body.content || '').trim();
    const useEmbed = req.body.use_embed === 'true' || req.body.use_embed === true;
    const embedTitle = String(req.body.embed_title || '').trim();
    const embedColor = String(req.body.embed_color || '#6366f1').trim();
    const uploadedFiles = (req.files as Express.Multer.File[] | undefined) || [];

    if (!channelId) {
      res.status(400).json({ error: 'Pilih channel tujuan terlebih dahulu.' });
      return;
    }
    if (!content && uploadedFiles.length === 0) {
      res.status(400).json({ error: 'Isi pesan atau lampiran tidak boleh kosong.' });
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
      const sent = await sendMessageToChannel({
        channelId,
        content,
        useEmbed,
        embedTitle,
        embedColor,
        attachments,
      });

      const post = addChannelPost({
        channel_id: channelId,
        channel_name: sent.channelName,
        embed_title: useEmbed && embedTitle ? embedTitle : null,
        content,
        attachments,
        discord_message_id: sent.discordMessageId,
        sent_by: req.user!.name,
      });

      logAudit({
        admin_username: req.user!.username,
        admin_name: req.user!.name,
        admin_role: req.user!.role,
        action: 'channel_post',
        target: `#${sent.channelName}`,
        details: (embedTitle ? `[${embedTitle}] ` : '') + content.slice(0, 120),
      });

      res.status(201).json({ post });
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal mengirim pesan ke channel.',
      });
    }
  }
);

