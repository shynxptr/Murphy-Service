import crypto from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { EmbedBuilder } from 'discord.js';
import { requireAuth, type AuthenticatedRequest } from '../auth.js';
import { config } from '../config.js';
import {
  addMessage,
  findPartnersByPicId,
  getConversationById,
  getMediaKit,
  getMessages,
  listConversations,
  listWarnings,
  logAudit,
  updateConversationMeta,
  upsertConversation,
} from '../db.js';
import {
  createFallbackPrivateThread,
  searchGuildMembers,
  sendMessageToDiscord,
} from '../bot.js';
import { emitConversationUpdated, emitNewMessage } from '../realtime.js';
import type {
  ConversationCategory,
  ConversationStatus,
  ConversationType,
  MessageAttachment,
} from '../types.js';

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

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

// Search Discord server members to initiate an anonymous DM
conversationsRouter.get('/members/search', async (req, res) => {
  const q = String(req.query.q || '');
  const members = await searchGuildMembers(q);
  res.json({ members });
});

conversationsRouter.get('/', (req, res) => {
  const type = req.query.type ? String(req.query.type) : undefined;
  const status = req.query.status ? String(req.query.status) : undefined;
  const search = req.query.search ? String(req.query.search) : undefined;
  res.json({ conversations: listConversations({ type, status, search }) });
});

// Start or open a conversation with any Discord user ID
conversationsRouter.post('/', (req, res) => {
  const { discord_user_id, discord_username, discord_avatar, type, category } = req.body as {
    discord_user_id?: string;
    discord_username?: string;
    discord_avatar?: string | null;
    type?: ConversationType;
    category?: ConversationCategory;
  };
  if (!discord_user_id?.trim()) {
    res.status(400).json({ error: 'Discord User ID wajib diisi.' });
    return;
  }
  const conversation = upsertConversation({
    discordUserId: discord_user_id.trim(),
    discordUsername: discord_username?.trim() || discord_user_id.trim(),
    discordAvatar: discord_avatar ?? null,
    type,
    category,
  });
  emitConversationUpdated(conversation);
  res.status(201).json({ conversation });
});

conversationsRouter.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const conversation = getConversationById(id);
  if (!conversation) {
    res.status(404).json({ error: 'Obrolan tidak ditemukan.' });
    return;
  }
  const messages = getMessages(id);
  const warnings = listWarnings(conversation.discord_user_id);
  const partners = findPartnersByPicId(conversation.discord_user_id);
  res.json({ conversation, messages, warnings, partners });
});

conversationsRouter.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const { status, category, assigned_to, mark_read } = req.body as {
    status?: ConversationStatus;
    category?: ConversationCategory;
    assigned_to?: string | null;
    mark_read?: boolean;
  };
  const updated = updateConversationMeta(id, {
    status,
    category,
    assigned_to,
    unread_count: mark_read ? 0 : undefined,
  });
  if (!updated) {
    res.status(404).json({ error: 'Obrolan tidak ditemukan.' });
    return;
  }
  emitConversationUpdated(updated);
  res.json({ conversation: updated });
});

// Send message (anonymous to Discord via Bot) OR internal note (web-only)
conversationsRouter.post(
  '/:id/messages',
  upload.array('files', 4),
  async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const conv = getConversationById(id);
    if (!conv) {
      res.status(404).json({ error: 'Obrolan tidak ditemukan.' });
      return;
    }

    const content = String(req.body.content || '').trim();
    const isInternalNote = req.body.is_internal_note === 'true' || req.body.is_internal_note === true;
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

    if (isInternalNote) {
      const msg = addMessage({
        conversationId: conv.id,
        senderType: 'internal_note',
        senderName: req.user!.name,
        adminUsername: req.user!.username,
        content,
        attachments,
        deliveryChannel: 'internal',
      });
      const latest = getConversationById(conv.id) || conv;
      emitNewMessage(latest, msg);
      res.status(201).json({ message: msg, conversation: latest });
      return;
    }

    try {
      const sent = await sendMessageToDiscord({
        conversation: conv,
        content,
        attachments,
      });

      const msg = addMessage({
        conversationId: conv.id,
        senderType: 'admin',
        senderName: req.user!.name,
        adminUsername: req.user!.username,
        content,
        attachments,
        discordMessageId: sent.discordMessageId,
        deliveryChannel: sent.deliveryChannel,
      });

      const latest = updateConversationMeta(conv.id, {
        unread_count: 0,
        status: conv.status === 'open' ? 'waiting_reply' : conv.status,
      })!;
      emitNewMessage(latest, msg);
      res.status(201).json({ message: msg, conversation: latest });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengirim pesan ke Discord.';
      if (msg === 'DM_BLOCKED') {
        res.status(422).json({
          error: 'DM member tertutup. Gunakan tombol "Kirim via Private Thread".',
          code: 'DM_BLOCKED',
          conversation: getConversationById(conv.id),
        });
        return;
      }
      res.status(500).json({ error: msg });
    }
  }
);

// Fallback: Create Private Thread in configured channel when member's DMs are closed
conversationsRouter.post('/:id/fallback-thread', async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const conv = getConversationById(id);
  if (!conv) {
    res.status(404).json({ error: 'Obrolan tidak ditemukan.' });
    return;
  }

  const initialMessage = req.body.initial_message
    ? String(req.body.initial_message).trim()
    : undefined;

  try {
    const result = await createFallbackPrivateThread(conv, initialMessage);
    const sysMsg = addMessage({
      conversationId: conv.id,
      senderType: 'system',
      senderName: `Fallback Private Thread (oleh ${req.user!.name})`,
      adminUsername: req.user!.username,
      content:
        initialMessage ||
        'Saluran Private Thread berhasil dibuat karena DM member tertutup. Pesan selanjutnya otomatis masuk ke thread tersebut.',
      discordMessageId: result.messageId || null,
      deliveryChannel: 'thread',
    });
    const latest = getConversationById(conv.id) || conv;
    emitNewMessage(latest, sysMsg);
    res.status(201).json({ conversation: latest, message: sysMsg, threadId: result.threadId });
  } catch (err: unknown) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Gagal membuat Private Thread.',
    });
  }
});

// Send 1-Click Media Kit Embed to this conversation
conversationsRouter.post('/:id/send-mediakit', async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const conv = getConversationById(id);
  if (!conv) {
    res.status(404).json({ error: 'Obrolan tidak ditemukan.' });
    return;
  }

  const kit = getMediaKit();
  const embed = new EmbedBuilder()
    .setTitle(`📦 Media Kit Resmi — ${kit.serverName}`)
    .setColor(0x6366f1)
    .setDescription(kit.description || 'Informasi resmi komunitas kami.')
    .setFooter({ text: 'Paket Media Kit • Tim Humas' })
    .setTimestamp();

  if (kit.requirements) {
    embed.addFields({ name: '📋 Syarat & Ketentuan Partnership', value: kit.requirements });
  }
  if (kit.inviteLink) {
    embed.addFields({ name: '🔗 Link Invite Resmi', value: kit.inviteLink });
  }
  if (kit.logoUrl && /^https?:\/\//i.test(kit.logoUrl)) {
    embed.setThumbnail(kit.logoUrl);
  }
  if (kit.bannerUrl && /^https?:\/\//i.test(kit.bannerUrl)) {
    embed.setImage(kit.bannerUrl);
  }

  try {
    const sent = await sendMessageToDiscord({
      conversation: conv,
      content: '',
      embed,
    });

    const msg = addMessage({
      conversationId: conv.id,
      senderType: 'admin',
      senderName: req.user!.name,
      adminUsername: req.user!.username,
      content: `[📦 MEDIA KIT] ${kit.serverName}\n${kit.description}${kit.inviteLink ? `\nLink: ${kit.inviteLink}` : ''}`,
      discordMessageId: sent.discordMessageId,
      deliveryChannel: sent.deliveryChannel,
    });

    const latest = updateConversationMeta(conv.id, {
      unread_count: 0,
      status: conv.status === 'open' ? 'waiting_reply' : conv.status,
    })!;
    emitNewMessage(latest, msg);

    logAudit({
      admin_username: req.user!.username,
      admin_name: req.user!.name,
      admin_role: req.user!.role,
      action: 'mediakit_send',
      target: conv.discord_username,
      details: `Mengirim Media Kit (${kit.serverName})`,
    });

    res.status(201).json({ message: msg, conversation: latest });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Gagal mengirim Media Kit.';
    if (msg === 'DM_BLOCKED') {
      res.status(422).json({
        error: 'DM member tertutup. Gunakan tombol "Kirim via Private Thread".',
        code: 'DM_BLOCKED',
      });
      return;
    }
    res.status(500).json({ error: msg });
  }
});
