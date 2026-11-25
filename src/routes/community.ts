import { Router } from 'express';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth.js';
import {
  createEventInvite,
  createSurvey,
  getMediaKit,
  getOfficeHours,
  getOverviewStats,
  getPartnerById,
  listAspirations,
  listEventsWithRsvps,
  listSurveyResponses,
  listSurveys,
  logAudit,
  saveMediaKit,
  saveOfficeHours,
  toggleSurveyActive,
  updateAspiration,
  upsertConversation,
  upsertEventRsvp,
} from '../db.js';
import { getBotStatus, sendMessageToDiscord } from '../bot.js';
import type { Aspiration, MediaKitSettings, OfficeHoursSettings } from '../types.js';

export const communityRouter = Router();
communityRouter.use(requireAuth);

// ---- Bot Status & Overview Dashboard ----
communityRouter.get('/status', (_req, res) => {
  res.json({ bot: getBotStatus() });
});

communityRouter.get('/overview', (_req, res) => {
  res.json({ stats: getOverviewStats() });
});

// ---- Media Kit Settings ----
communityRouter.get('/settings/media-kit', (_req, res) => {
  res.json({ mediaKit: getMediaKit() });
});

communityRouter.put('/settings/media-kit', requireRole('superadmin'), (req: AuthenticatedRequest, res) => {
  const body = req.body as Partial<MediaKitSettings>;
  const current = getMediaKit();
  const updated = saveMediaKit({
    serverName: body.serverName?.trim() || current.serverName,
    description: body.description !== undefined ? body.description.trim() : current.description,
    requirements: body.requirements !== undefined ? body.requirements.trim() : current.requirements,
    inviteLink: body.inviteLink !== undefined ? body.inviteLink.trim() : current.inviteLink,
    logoUrl: body.logoUrl !== undefined ? body.logoUrl.trim() : current.logoUrl,
    bannerUrl: body.bannerUrl !== undefined ? body.bannerUrl.trim() : current.bannerUrl,
  });
  logAudit({
    admin_username: req.user!.username,
    admin_name: req.user!.name,
    admin_role: req.user!.role,
    action: 'settings_update',
    target: 'Media Kit',
    details: `Server: ${updated.serverName}`,
  });
  res.json({ mediaKit: updated });
});

// ---- Office Hours Settings ----
communityRouter.get('/settings/office-hours', (_req, res) => {
  res.json({ officeHours: getOfficeHours() });
});

communityRouter.put('/settings/office-hours', requireRole('superadmin'), (req: AuthenticatedRequest, res) => {
  const body = req.body as Partial<OfficeHoursSettings>;
  const current = getOfficeHours();
  const updated = saveOfficeHours({
    enabled: Boolean(body.enabled),
    timezone: body.timezone || current.timezone,
    startHour: Number.isFinite(Number(body.startHour)) ? Number(body.startHour) : current.startHour,
    endHour: Number.isFinite(Number(body.endHour)) ? Number(body.endHour) : current.endHour,
    activeDays: Array.isArray(body.activeDays) ? body.activeDays.map(Number) : current.activeDays,
    awayMessage: body.awayMessage?.trim() || current.awayMessage,
  });
  logAudit({
    admin_username: req.user!.username,
    admin_name: req.user!.name,
    admin_role: req.user!.role,
    action: 'settings_update',
    target: 'Office Hours',
    details: `Aktif: ${updated.enabled ? 'Ya' : 'Tidak'} (${updated.startHour}:00–${updated.endHour}:00)`,
  });
  res.json({ officeHours: updated });
});

// ---- Aspirations (Kotak Saran / Aduan) ----
communityRouter.get('/aspirations', (_req, res) => {
  res.json({ aspirations: listAspirations() });
});

communityRouter.patch('/aspirations/:id', (req, res) => {
  const id = Number(req.params.id);
  const { status, admin_notes } = req.body as {
    status?: Aspiration['status'];
    admin_notes?: string;
  };
  const updated = updateAspiration(id, status || 'reviewed', admin_notes || '');
  if (!updated) {
    res.status(404).json({ error: 'Aspirasi tidak ditemukan.' });
    return;
  }
  res.json({ aspiration: updated });
});

// ---- Events & Partner RSVP ----
communityRouter.get('/events', (_req, res) => {
  res.json({ events: listEventsWithRsvps() });
});

communityRouter.post('/events', async (req: AuthenticatedRequest, res) => {
  const { title, description, event_date, partner_ids } = req.body as {
    title?: string;
    description?: string;
    event_date?: string;
    partner_ids?: number[];
  };

  if (!title?.trim() || !event_date?.trim()) {
    res.status(400).json({ error: 'Judul event dan tanggal event wajib diisi.' });
    return;
  }

  const event = createEventInvite({
    title: title.trim(),
    description: (description || '').trim(),
    event_date: event_date.trim(),
    created_by: req.user!.name,
  });

  const targets = (Array.isArray(partner_ids) ? partner_ids : [])
    .map((id) => getPartnerById(Number(id)))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  for (const partner of targets) {
    upsertEventRsvp(event.id, partner.id, partner.pic_discord_id, 'pending');
  }

  res.status(201).json({ event, invitedCount: targets.length });

  // Send RSVP DM invites in background with rate-limit-safe delay
  for (const partner of targets) {
    const conv = upsertConversation({
      discordUserId: partner.pic_discord_id,
      discordUsername: partner.pic_username,
      type: 'partner',
      category: 'partnership',
    });

    const embed = new EmbedBuilder()
      .setTitle(`🎟️ Undangan Event: ${event.title}`)
      .setDescription(
        `${event.description || 'Kami mengundang rekan partner untuk hadir dalam acara kami!'}\n\n📅 **Waktu:** ${event.event_date}\n\nSilakan konfirmasi kehadiran melalui tombol di bawah ini:`
      )
      .setColor(0x10b981)
      .setFooter({ text: `Undangan Resmi Tim Humas • Partner: ${partner.server_name}` })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`rsvp:${event.id}:${partner.id}:attending`)
        .setLabel('Hadir')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`rsvp:${event.id}:${partner.id}:representative`)
        .setLabel('Kirim Perwakilan')
        .setEmoji('👥')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`rsvp:${event.id}:${partner.id}:declined`)
        .setLabel('Tidak Hadir')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Secondary)
    );

    try {
      await sendMessageToDiscord({
        conversation: conv,
        content: '',
        embed,
        components: [row],
      });
    } catch {
      upsertEventRsvp(event.id, partner.id, partner.pic_discord_id, 'failed');
    }

    await new Promise((r) => setTimeout(r, 2000));
  }
});

// ---- Surveys (Evaluasi Event) ----
communityRouter.get('/surveys', (_req, res) => {
  res.json({ surveys: listSurveys() });
});

communityRouter.post('/surveys', (req: AuthenticatedRequest, res) => {
  const { title, description } = req.body as { title?: string; description?: string };
  if (!title?.trim()) {
    res.status(400).json({ error: 'Judul survei wajib diisi.' });
    return;
  }
  const survey = createSurvey(title.trim(), (description || '').trim(), req.user!.name);
  res.status(201).json({ survey });
});

communityRouter.patch('/surveys/:id/toggle', (req, res) => {
  const id = Number(req.params.id);
  const { is_active } = req.body as { is_active?: boolean };
  toggleSurveyActive(id, Boolean(is_active));
  res.json({ ok: true });
});

communityRouter.get('/surveys/:id/responses', (req, res) => {
  const id = Number(req.params.id);
  res.json({ responses: listSurveyResponses(id) });
});
