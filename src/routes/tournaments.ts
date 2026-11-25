import { Router } from 'express';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth.js';
import { discordClient, isBotReady } from '../bot.js';
import {
  createTournament,
  deleteTournament,
  getTournamentById,
  getTournamentNotifSettings,
  getTournamentRegistrationById,
  listTournamentRegistrations,
  listTournaments,
  logAudit,
  saveTournamentNotifSettings,
  toggleTournamentOpen,
  updateTournamentRegistrationStatus,
} from '../db.js';
import {
  handleRegistrationDecisionEffects,
  postTournamentPanelToChannel,
  refreshTournamentPanelMessage,
} from '../tournaments.js';
import type { TournamentMode, TournamentNotifSettings } from '../types.js';

export const tournamentsRouter = Router();
tournamentsRouter.use(requireAuth);

tournamentsRouter.get('/', (_req, res) => {
  res.json({
    tournaments: listTournaments(),
    notifSettings: getTournamentNotifSettings(),
  });
});

tournamentsRouter.put('/notif-settings', requireRole('superadmin'), (req: AuthenticatedRequest, res) => {
  const body = req.body as Partial<TournamentNotifSettings>;
  const saved = saveTournamentNotifSettings(body);
  logAudit({
    admin_username: req.user!.username,
    admin_name: req.user!.name,
    admin_role: req.user!.role,
    action: 'settings_update',
    target: 'Notif Approve Turnamen',
    details: `Channel: ${saved.announceChannelId || '-'}, DM: ${saved.sendDm}`,
  });
  res.json({ notifSettings: saved });
});

tournamentsRouter.post('/', async (req: AuthenticatedRequest, res) => {
  const {
    title,
    game = 'Umum',
    mode = 'team',
    max_slots = 16,
    description = '',
    participant_role_id = null,
    post_channel_id = '',
  } = req.body as {
    title?: string;
    game?: string;
    mode?: TournamentMode;
    max_slots?: number;
    description?: string;
    participant_role_id?: string | null;
    post_channel_id?: string;
  };

  if (!title?.trim()) {
    res.status(400).json({ error: 'Nama turnamen wajib diisi.' });
    return;
  }

  const trn = createTournament({
    title: title.trim(),
    game: game.trim() || 'Umum',
    mode: mode === 'solo' ? 'solo' : 'team',
    max_slots: Math.max(2, Math.min(512, Number(max_slots) || 16)),
    description: description.trim(),
    participant_role_id: participant_role_id ? String(participant_role_id).trim() : null,
    created_by: req.user!.name,
  });

  let posted = false;
  let postError: string | null = null;
  if (post_channel_id?.trim() && isBotReady()) {
    try {
      await postTournamentPanelToChannel(discordClient, trn.id, post_channel_id.trim());
      posted = true;
    } catch (err) {
      postError = err instanceof Error ? err.message : 'Gagal post panel ke channel.';
    }
  }

  logAudit({
    admin_username: req.user!.username,
    admin_name: req.user!.name,
    admin_role: req.user!.role,
    action: 'tournament_create',
    target: trn.title,
    details: `${trn.game} (${trn.mode}, ${trn.max_slots} slot)`,
  });

  res.status(201).json({ tournament: getTournamentById(trn.id), posted, postError });
});

tournamentsRouter.post('/:id/post', async (req, res) => {
  const id = Number(req.params.id);
  const channelId = String(req.body.channel_id || '').trim();
  if (!channelId) {
    res.status(400).json({ error: 'Pilih channel Discord tujuan.' });
    return;
  }
  if (!isBotReady()) {
    res.status(503).json({ error: 'Bot Discord belum terhubung.' });
    return;
  }
  try {
    const result = await postTournamentPanelToChannel(discordClient, id, channelId);
    res.json({ ok: true, messageId: result.messageId, tournament: getTournamentById(id) });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Gagal memposting panel pendaftaran.',
    });
  }
});

tournamentsRouter.patch('/:id/toggle', async (req, res) => {
  const id = Number(req.params.id);
  const isOpen = Boolean(req.body.is_open);
  const updated = toggleTournamentOpen(id, isOpen);
  if (!updated) {
    res.status(404).json({ error: 'Turnamen tidak ditemukan.' });
    return;
  }
  if (isBotReady()) {
    await refreshTournamentPanelMessage(discordClient, id);
  }
  res.json({ tournament: updated });
});

tournamentsRouter.delete('/:id', requireRole('superadmin'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const trn = getTournamentById(id);
  deleteTournament(id);
  if (trn) {
    logAudit({
      admin_username: req.user!.username,
      admin_name: req.user!.name,
      admin_role: req.user!.role,
      action: 'tournament_delete',
      target: trn.title,
      details: `Menghapus turnamen ${trn.game}`,
    });
  }
  res.json({ ok: true });
});

tournamentsRouter.get('/:id/registrations', (req, res) => {
  const id = Number(req.params.id);
  res.json({ registrations: listTournamentRegistrations(id) });
});

tournamentsRouter.get('/:id/export/csv', (req, res) => {
  const id = Number(req.params.id);
  const trn = getTournamentById(id);
  const rows = listTournamentRegistrations(id);
  const header =
    'ID,TeamOrNick,CaptainUsername,CaptainDiscordID,Contact,Roster,Substitutes,Notes,Status,ReviewedBy,CreatedAt';
  const lines = rows.map((r) =>
    [
      r.id,
      `"${r.team_name.replace(/"/g, '""')}"`,
      `"${r.captain_username.replace(/"/g, '""')}"`,
      r.captain_discord_id,
      `"${r.representative_contact.replace(/"/g, '""')}"`,
      `"${r.roster_text.replace(/\r?\n/g, ' | ').replace(/"/g, '""')}"`,
      `"${r.substitutes.replace(/"/g, '""')}"`,
      `"${r.notes.replace(/"/g, '""')}"`,
      r.status,
      `"${(r.reviewed_by || '').replace(/"/g, '""')}"`,
      r.created_at,
    ].join(',')
  );
  const safeSlug = (trn?.title || `turnamen-${id}`).replace(/[^a-zA-Z0-9_-]/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeSlug}-peserta.csv"`);
  res.send([header, ...lines].join('\n'));
});

tournamentsRouter.patch('/registrations/:regId', async (req: AuthenticatedRequest, res) => {
  const regId = Number(req.params.regId);
  const { status, reject_reason = '' } = req.body as {
    status?: 'approved' | 'rejected' | 'pending';
    reject_reason?: string;
  };
  if (status !== 'approved' && status !== 'rejected' && status !== 'pending') {
    res.status(400).json({ error: 'Status tidak valid.' });
    return;
  }

  const existing = getTournamentRegistrationById(regId);
  if (!existing) {
    res.status(404).json({ error: 'Data pendaftaran tidak ditemukan.' });
    return;
  }

  const trn = getTournamentById(existing.tournament_id);
  if (!trn) {
    res.status(404).json({ error: 'Turnamen tidak ditemukan.' });
    return;
  }

  const updated = updateTournamentRegistrationStatus(
    regId,
    status,
    req.user!.name,
    status === 'rejected' ? reject_reason.trim() : ''
  )!;

  let effects = { dmSent: false, channelNotified: false, roleAssigned: false };
  if ((status === 'approved' || status === 'rejected') && isBotReady()) {
    effects = await handleRegistrationDecisionEffects(discordClient, trn, updated, status);
  }

  logAudit({
    admin_username: req.user!.username,
    admin_name: req.user!.name,
    admin_role: req.user!.role,
    action: status === 'approved' ? 'tournament_approve' : 'tournament_reject',
    target: `${updated.team_name} (${trn.title})`,
    details:
      status === 'rejected'
        ? `Ditolak: ${reject_reason || '-'}`
        : `Disetujui (DM: ${effects.dmSent}, Channel: ${effects.channelNotified})`,
  });

  res.json({ registration: updated, tournament: getTournamentById(trn.id), effects });
});
