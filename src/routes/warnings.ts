import { Router } from 'express';
import { EmbedBuilder } from 'discord.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth.js';
import {
  addMessage,
  createWarning,
  deleteWarning,
  getConversationById,
  listWarnings,
  logAudit,
  upsertConversation,
} from '../db.js';
import { sendMessageToDiscord } from '../bot.js';
import { emitNewMessage } from '../realtime.js';

export const warningsRouter = Router();
warningsRouter.use(requireAuth);

warningsRouter.get('/', (req, res) => {
  const targetDiscordId = req.query.target_discord_id ? String(req.query.target_discord_id) : undefined;
  res.json({ warnings: listWarnings(targetDiscordId) });
});

warningsRouter.get('/export/csv', (_req, res) => {
  const rows = listWarnings();
  const header = 'ID,TargetDiscordID,TargetUsername,Type,Level,Reason,IssuedBy,CreatedAt';
  const lines = rows.map((r) =>
    [
      r.id,
      r.target_discord_id,
      `"${r.target_username.replace(/"/g, '""')}"`,
      r.target_type,
      r.level,
      `"${r.reason.replace(/"/g, '""')}"`,
      `"${r.issued_by.replace(/"/g, '""')}"`,
      r.created_at,
    ].join(',')
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="humas-warnings.csv"');
  res.send([header, ...lines].join('\n'));
});

warningsRouter.post('/', async (req: AuthenticatedRequest, res) => {
  const {
    target_discord_id,
    target_username,
    target_type = 'member',
    partner_id = null,
    level = 1,
    reason,
    send_dm = true,
  } = req.body as {
    target_discord_id?: string;
    target_username?: string;
    target_type?: 'member' | 'partner';
    partner_id?: number | null;
    level?: number;
    reason?: string;
    send_dm?: boolean;
  };

  if (!target_discord_id?.trim() || !reason?.trim()) {
    res.status(400).json({ error: 'Target Discord ID dan alasan pelanggaran wajib diisi.' });
    return;
  }

  const warning = createWarning({
    target_discord_id: target_discord_id.trim(),
    target_username: target_username?.trim() || target_discord_id.trim(),
    target_type,
    partner_id,
    level: Number(level) || 1,
    reason: reason.trim(),
    issued_by: req.user!.name,
  });

  logAudit({
    admin_username: req.user!.username,
    admin_name: req.user!.name,
    admin_role: req.user!.role,
    action: 'warning_issue',
    target: `${warning.target_username} (${warning.target_type})`,
    details: `Level ${warning.level}: ${warning.reason.slice(0, 120)}`,
  });

  let dmSent = false;
  let dmError: string | null = null;

  if (send_dm) {
    const conv = upsertConversation({
      discordUserId: warning.target_discord_id,
      discordUsername: warning.target_username,
      type: target_type === 'partner' ? 'partner' : 'member',
      category: 'warning',
    });

    const embed = new EmbedBuilder()
      .setTitle(`⚠️ Peringatan Resmi (Level ${warning.level})`)
      .setColor(warning.level >= 3 ? 0xef4444 : warning.level === 2 ? 0xf97316 : 0xeab308)
      .setDescription(
        `Halo, kami dari **Tim Humas & Moderasi** menyampaikan peringatan resmi terkait:\n\n**Alasan:**\n${warning.reason}\n\nJika ingin memberikan klarifikasi, silakan balas langsung pesan ini.`
      )
      .setFooter({ text: 'Pesan resmi otomatis • Tim Humas' })
      .setTimestamp();

    try {
      const sent = await sendMessageToDiscord({
        conversation: conv,
        content: '',
        embed,
      });
      dmSent = true;
      const msg = addMessage({
        conversationId: conv.id,
        senderType: 'admin',
        senderName: req.user!.name,
        adminUsername: req.user!.username,
        content: `[⚠️ WARNING LEVEL ${warning.level}] ${warning.reason}`,
        discordMessageId: sent.discordMessageId,
        deliveryChannel: sent.deliveryChannel,
      });
      emitNewMessage(getConversationById(conv.id) || conv, msg);
    } catch (err: unknown) {
      dmError = err instanceof Error ? err.message : 'Gagal mengirim DM warning';
    }
  }

  res.status(201).json({ warning, dmSent, dmError });
});

warningsRouter.delete('/:id', requireRole('superadmin'), (req: AuthenticatedRequest, res) => {
  deleteWarning(Number(req.params.id));
  logAudit({
    admin_username: req.user!.username,
    admin_name: req.user!.name,
    admin_role: req.user!.role,
    action: 'warning_delete',
    target: `Warning #${req.params.id}`,
    details: 'Menghapus catatan warning',
  });
  res.json({ ok: true });
});
