import { Router } from 'express';
import { EmbedBuilder } from 'discord.js';
import { requireAuth, type AuthenticatedRequest } from '../auth.js';
import {
  addMessage,
  deleteQuickContact,
  getConversationById,
  getQuickContactById,
  listQuickContacts,
  logAudit,
  upsertConversation,
  upsertQuickContact,
} from '../db.js';
import { sendMessageToDiscord } from '../bot.js';
import { emitNewMessage } from '../realtime.js';
import type { QuickContactGroup } from '../types.js';

export const quickContactsRouter = Router();
quickContactsRouter.use(requireAuth);

quickContactsRouter.get('/', (_req, res) => {
  res.json({ contacts: listQuickContacts() });
});

quickContactsRouter.post('/', (req: AuthenticatedRequest, res) => {
  const { discord_user_id, discord_username, label, group_tag, notes } = req.body as {
    discord_user_id?: string;
    discord_username?: string;
    label?: string;
    group_tag?: QuickContactGroup;
    notes?: string;
  };

  if (!discord_user_id?.trim()) {
    res.status(400).json({ error: 'Discord User ID wajib diisi.' });
    return;
  }

  const contact = upsertQuickContact({
    discord_user_id: discord_user_id.trim(),
    discord_username: discord_username?.trim() || discord_user_id.trim(),
    label: label?.trim() || discord_username?.trim() || discord_user_id.trim(),
    group_tag: group_tag || 'staff',
    notes: notes?.trim() || '',
    created_by: req.user!.name,
  });

  res.status(201).json({ contact });
});

quickContactsRouter.delete('/:id', (req, res) => {
  deleteQuickContact(Number(req.params.id));
  res.json({ ok: true });
});

// Send a quick reminder DM to 1 or multiple saved contacts (e.g., Staff / Benefit reminders)
quickContactsRouter.post('/remind', async (req: AuthenticatedRequest, res) => {
  const { contact_ids, title, message, use_embed = true } = req.body as {
    contact_ids?: number[];
    title?: string;
    message?: string;
    use_embed?: boolean;
  };

  if (!Array.isArray(contact_ids) || contact_ids.length === 0 || !message?.trim()) {
    res.status(400).json({ error: 'Pilih minimal 1 kontak dan isi pesan reminder.' });
    return;
  }

  const targets = contact_ids
    .map((id) => getQuickContactById(Number(id)))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  if (targets.length === 0) {
    res.status(404).json({ error: 'Kontak tidak ditemukan.' });
    return;
  }

  const results: Array<{ id: number; label: string; ok: boolean; error?: string }> = [];

  for (let i = 0; i < targets.length; i++) {
    const contact = targets[i];
    const conv = upsertConversation({
      discordUserId: contact.discord_user_id,
      discordUsername: contact.discord_username,
      type: 'member',
      category: contact.group_tag === 'benefit' ? 'benefit' : 'general',
    });

    const reminderTitle = title?.trim() || '🔔 Quick Reminder — Tim Humas';
    const embed = use_embed
      ? new EmbedBuilder()
          .setTitle(reminderTitle)
          .setDescription(message.trim())
          .setColor(0x6366f1)
          .setFooter({ text: 'Pesan reminder resmi • Tim Humas' })
          .setTimestamp()
      : undefined;

    try {
      const sent = await sendMessageToDiscord({
        conversation: conv,
        content: use_embed ? '' : `${reminderTitle}\n\n${message.trim()}`,
        embed,
      });

      const savedMsg = addMessage({
        conversationId: conv.id,
        senderType: 'admin',
        senderName: req.user!.name,
        adminUsername: req.user!.username,
        content: `[🔔 REMINDER] ${title ? `${title}\n` : ''}${message.trim()}`,
        discordMessageId: sent.discordMessageId,
        deliveryChannel: sent.deliveryChannel,
      });
      emitNewMessage(getConversationById(conv.id) || conv, savedMsg);
      results.push({ id: contact.id, label: contact.label, ok: true });
    } catch (err: unknown) {
      results.push({
        id: contact.id,
        label: contact.label,
        ok: false,
        error: err instanceof Error ? err.message : 'Gagal kirim DM',
      });
    }

    // Small safe delay when sending to multiple contacts
    if (i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  const sentCount = results.filter((r) => r.ok).length;
  const failedCount = results.length - sentCount;
  logAudit({
    admin_username: req.user!.username,
    admin_name: req.user!.name,
    admin_role: req.user!.role,
    action: 'quick_reminder',
    target: `${targets.length} kontak (${sentCount} terkirim)`,
    details: (title ? `[${title}] ` : '') + message.trim().slice(0, 120),
  });
  res.json({ sentCount, failedCount, results });
});

