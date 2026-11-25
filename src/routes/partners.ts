import crypto from 'node:crypto';
import { Router } from 'express';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth.js';
import {
  addMessage,
  createPartner,
  deletePartner,
  getConversationById,
  getPartnerById,
  listPartners,
  logAudit,
  recordBroadcastReceipt,
  updatePartner,
  upsertConversation,
} from '../db.js';
import { checkDiscordInvite, sendMessageToDiscord } from '../bot.js';
import { emitBroadcastProgress, emitNewMessage } from '../realtime.js';

export const partnersRouter = Router();
partnersRouter.use(requireAuth);

partnersRouter.get('/', (_req, res) => {
  res.json({ partners: listPartners() });
});

partnersRouter.get('/export/csv', (_req, res) => {
  const rows = listPartners();
  const header =
    'ID,ServerName,PicDiscordID,PicUsername,BackupPicName,InviteLink,InviteStatus,Tags,Status,Strikes,JoinedAt';
  const lines = rows.map((p) =>
    [
      p.id,
      `"${p.server_name.replace(/"/g, '""')}"`,
      p.pic_discord_id,
      `"${p.pic_username.replace(/"/g, '""')}"`,
      `"${(p.backup_pic_name || '').replace(/"/g, '""')}"`,
      `"${(p.invite_link || '').replace(/"/g, '""')}"`,
      p.invite_status,
      `"${p.tags.join('; ')}"`,
      p.status,
      p.strikes,
      p.joined_at,
    ].join(',')
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="humas-partners.csv"');
  res.send([header, ...lines].join('\n'));
});

partnersRouter.post('/', (req: AuthenticatedRequest, res) => {
  const {
    server_name,
    pic_discord_id,
    pic_username,
    backup_pic_discord_id,
    backup_pic_name,
    invite_link,
    tags,
    status,
    collaboration_history,
    notes,
  } = req.body;

  if (!server_name?.trim() || !pic_discord_id?.trim()) {
    res.status(400).json({ error: 'Nama server dan Discord ID PIC wajib diisi.' });
    return;
  }

  const partner = createPartner({
    server_name: String(server_name).trim(),
    pic_discord_id: String(pic_discord_id).trim(),
    pic_username: String(pic_username || pic_discord_id).trim(),
    backup_pic_discord_id: backup_pic_discord_id ? String(backup_pic_discord_id).trim() : null,
    backup_pic_name: backup_pic_name ? String(backup_pic_name).trim() : null,
    invite_link: invite_link ? String(invite_link).trim() : null,
    tags: Array.isArray(tags) ? tags.map((t: unknown) => String(t).trim()).filter(Boolean) : [],
    status,
    collaboration_history: String(collaboration_history || ''),
    notes: String(notes || ''),
  });

  logAudit({
    admin_username: req.user!.username,
    admin_name: req.user!.name,
    admin_role: req.user!.role,
    action: 'partner_create',
    target: partner.server_name,
    details: `PIC: ${partner.pic_username} (${partner.pic_discord_id})`,
  });

  res.status(201).json({ partner });
});

partnersRouter.put('/:id', (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = getPartnerById(id);
  if (!existing) {
    res.status(404).json({ error: 'Partner tidak ditemukan.' });
    return;
  }
  const partner = updatePartner(id, req.body);
  logAudit({
    admin_username: req.user!.username,
    admin_name: req.user!.name,
    admin_role: req.user!.role,
    action: 'partner_update',
    target: partner?.server_name || existing.server_name,
    details: `Status: ${partner?.status || existing.status}`,
  });
  res.json({ partner });
});

partnersRouter.delete('/:id', requireRole('superadmin'), (req: AuthenticatedRequest, res) => {
  const existing = getPartnerById(Number(req.params.id));
  deletePartner(Number(req.params.id));
  if (existing) {
    logAudit({
      admin_username: req.user!.username,
      admin_name: req.user!.name,
      admin_role: req.user!.role,
      action: 'partner_delete',
      target: existing.server_name,
      details: `PIC: ${existing.pic_username}`,
    });
  }
  res.json({ ok: true });
});

// Check validity of a partner's Discord invite link
partnersRouter.post('/:id/check-invite', async (req, res) => {
  const id = Number(req.params.id);
  const partner = getPartnerById(id);
  if (!partner) {
    res.status(404).json({ error: 'Partner tidak ditemukan.' });
    return;
  }
  if (!partner.invite_link) {
    res.status(400).json({ error: 'Partner belum memiliki link invite.' });
    return;
  }

  const inviteStatus = await checkDiscordInvite(partner.invite_link);
  const updated = updatePartner(id, { invite_status: inviteStatus });
  res.json({ partner: updated, invite_status: inviteStatus });
});

// Rate-limit-safe segmented broadcast to selected partners with Read Receipt buttons
partnersRouter.post('/broadcast', requireRole('superadmin'), async (req: AuthenticatedRequest, res) => {
  const { partner_ids, title, content, include_receipt_buttons = true } = req.body as {
    partner_ids?: number[];
    title?: string;
    content?: string;
    include_receipt_buttons?: boolean;
  };

  if (!Array.isArray(partner_ids) || partner_ids.length === 0 || !content?.trim()) {
    res.status(400).json({ error: 'Pilih minimal 1 partner dan isi pesan broadcast.' });
    return;
  }

  const targets = partner_ids
    .map((id) => getPartnerById(Number(id)))
    .filter((p): p is NonNullable<typeof p> => Boolean(p && p.status === 'active'));

  if (targets.length === 0) {
    res.status(400).json({ error: 'Tidak ada partner aktif yang dipilih.' });
    return;
  }

  const broadcastId = crypto.randomBytes(6).toString('hex');
  const adminName = req.user!.name;
  const adminUsername = req.user!.username;

  logAudit({
    admin_username: adminUsername,
    admin_name: adminName,
    admin_role: req.user!.role,
    action: 'partner_broadcast',
    target: `${targets.length} partner`,
    details: (title ? `[${title}] ` : '') + content.trim().slice(0, 120),
  });

  // Return immediately and process queue asynchronously with safe delay (2.5s between DMs)
  res.status(202).json({
    broadcastId,
    total: targets.length,
    message: `Broadcast dimulai untuk ${targets.length} partner (antrean aman berjeda).`,
  });

  let sentCount = 0;
  let failedCount = 0;

  for (const partner of targets) {
    emitBroadcastProgress({
      broadcastId,
      total: targets.length,
      sent: sentCount,
      failed: failedCount,
      done: false,
      currentPartner: partner.server_name,
    });

    const conv = upsertConversation({
      discordUserId: partner.pic_discord_id,
      discordUsername: partner.pic_username,
      type: 'partner',
      category: 'partnership',
    });

    const embed = new EmbedBuilder()
      .setTitle(title?.trim() || '📢 Informasi Partnership — Tim Humas')
      .setDescription(content.trim())
      .setColor(0x6366f1)
      .setFooter({ text: `Ditujukan untuk Partner: ${partner.server_name}` })
      .setTimestamp();

    const components = include_receipt_buttons
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`receipt:${broadcastId}:${partner.id}:confirmed`)
              .setLabel('Sudah Dibaca / Siap Share')
              .setEmoji('✅')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`receipt:${broadcastId}:${partner.id}:declined`)
              .setLabel('Sedang Berhalangan')
              .setEmoji('❌')
              .setStyle(ButtonStyle.Secondary)
          ),
        ]
      : [];

    try {
      const sent = await sendMessageToDiscord({
        conversation: conv,
        content: '',
        embed,
        components,
      });
      sentCount++;
      recordBroadcastReceipt(broadcastId, partner.id, partner.pic_discord_id, 'sent');
      const msg = addMessage({
        conversationId: conv.id,
        senderType: 'admin',
        senderName: adminName,
        adminUsername,
        content: `[📢 BROADCAST] ${title ? `${title}\n` : ''}${content.trim()}`,
        discordMessageId: sent.discordMessageId,
        deliveryChannel: sent.deliveryChannel,
      });
      emitNewMessage(getConversationById(conv.id) || conv, msg);
    } catch {
      failedCount++;
      recordBroadcastReceipt(broadcastId, partner.id, partner.pic_discord_id, 'failed');
    }

    // Rate-limit-safe delay between DMs (2.5 seconds)
    await new Promise((r) => setTimeout(r, 2500));
  }

  emitBroadcastProgress({
    broadcastId,
    total: targets.length,
    sent: sentCount,
    failed: failedCount,
    done: true,
  });
});
