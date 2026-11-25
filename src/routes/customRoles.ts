import { Router } from 'express';
import { EmbedBuilder } from 'discord.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth.js';
import { config } from '../config.js';
import { discordClient, isBotReady } from '../bot.js';
import {
  applyRoleColors,
  normalizeHexColor,
  positionRoleBelowBot,
} from '../customRole.js';
import {
  deleteCustomRoleByUserId,
  getCustomRoleByUserId,
  getCustomRoleSettings,
  listCustomRoles,
  logAudit,
  saveCustomRoleSettings,
  upsertCustomRole,
} from '../db.js';
import type { CustomRoleSettings } from '../types.js';

export const customRolesRouter = Router();
customRolesRouter.use(requireAuth);

customRolesRouter.get('/', (_req, res) => {
  res.json({
    roles: listCustomRoles(),
    settings: getCustomRoleSettings(),
  });
});

customRolesRouter.put('/settings', requireRole('superadmin'), (req: AuthenticatedRequest, res) => {
  const body = req.body as Partial<CustomRoleSettings>;
  const current = getCustomRoleSettings();
  const updated = saveCustomRoleSettings({
    enabled: body.enabled !== undefined ? Boolean(body.enabled) : current.enabled,
    anchorRoleId: body.anchorRoleId !== undefined ? String(body.anchorRoleId).trim() : current.anchorRoleId,
    defaultMaxShares: Number.isFinite(Number(body.defaultMaxShares))
      ? Math.max(0, Math.min(50, Number(body.defaultMaxShares)))
      : current.defaultMaxShares,
    allowHoist: body.allowHoist !== undefined ? Boolean(body.allowHoist) : current.allowHoist,
  });

  logAudit({
    admin_username: req.user!.username,
    admin_name: req.user!.name,
    admin_role: req.user!.role,
    action: 'settings_update',
    target: 'Custom Role (/mrole)',
    details: `Aktif: ${updated.enabled}, MaxShare: ${updated.defaultMaxShares}, Hoist: ${updated.allowHoist}`,
  });

  res.json({ settings: updated });
});

// Grant Custom Role access (for giveaway winners / VIP / non-boosters)
customRolesRouter.post('/grant', async (req: AuthenticatedRequest, res) => {
  const {
    discord_user_id,
    discord_username,
    max_shares,
    role_name,
    role_color,
    side_color,
    notify_dm = true,
  } = req.body as {
    discord_user_id?: string;
    discord_username?: string;
    max_shares?: number;
    role_name?: string;
    role_color?: string;
    side_color?: string;
    notify_dm?: boolean;
  };

  if (!discord_user_id?.trim()) {
    res.status(400).json({ error: 'Discord User ID wajib diisi.' });
    return;
  }

  const userId = discord_user_id.trim();
  const cfg = getCustomRoleSettings();
  const resolvedMaxShares = Number.isFinite(Number(max_shares))
    ? Math.max(0, Math.min(50, Number(max_shares)))
    : cfg.defaultMaxShares;

  let createdRoleId: string | null = getCustomRoleByUserId(userId)?.role_id || null;
  let finalName = role_name?.trim() || '';
  const primaryHex = normalizeHexColor(role_color) || '#CECECE';
  const sideHex = normalizeHexColor(side_color) || null;

  // Optionally create the Discord role right away if role_name is provided & bot is online
  if (finalName && !createdRoleId && isBotReady() && config.guildId) {
    try {
      const guild = await discordClient.guilds.fetch(config.guildId);
      const createdRole = await guild.roles.create({
        name: finalName,
        color: primaryHex as `#${string}`,
        permissions: [],
        reason: `Custom Role Benefit diberikan oleh ${req.user!.name}`,
      });
      await positionRoleBelowBot(guild, createdRole);
      if (sideHex) {
        await applyRoleColors(guild, createdRole, primaryHex, sideHex);
      }
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member) {
        await member.roles.add(createdRole).catch(() => {});
      }
      createdRoleId = createdRole.id;
    } catch (err) {
      console.error('[CustomRole] Gagal auto-create role dari web:', err);
    }
  }

  const record = upsertCustomRole({
    discord_user_id: userId,
    discord_username: discord_username?.trim() || userId,
    role_id: createdRoleId,
    source: 'admin_grant',
    name: finalName,
    color: primaryHex,
    side_color: sideHex,
    max_shares: resolvedMaxShares,
    history: [
      {
        action: `Granted Custom Role access by ${req.user!.name}`,
        timestamp: Date.now(),
      },
    ],
  });

  if (notify_dm && isBotReady()) {
    try {
      const user = await discordClient.users.fetch(userId);
      const embed = new EmbedBuilder()
        .setTitle('🎨 Akses Custom Role Aktif!')
        .setColor(0x6366f1)
        .setDescription(
          createdRoleId
            ? `Selamat! Tim Humas telah membuatkan Custom Role **${finalName}** untukmu!\n\nKetik \`/mrole\` atau \`!mrole\` di server kapan saja untuk mengubah nama, warna gradasi, icon, atau share ke hingga **${resolvedMaxShares} teman**.`
            : `Selamat! Kamu mendapatkan akses **Custom Role** dari Tim Humas!\n\nKetik \`/mrole\` atau \`!mrole\` di server untuk langsung membuat & mengkustomisasi role pribadimu (termasuk kuota share ke **${resolvedMaxShares} teman**).`
        )
        .setFooter({ text: 'Tim Humas' })
        .setTimestamp();
      await user.send({ embeds: [embed] }).catch(() => {});
    } catch {
      // Ignore if DM closed
    }
  }

  logAudit({
    admin_username: req.user!.username,
    admin_name: req.user!.name,
    admin_role: req.user!.role,
    action: 'custom_role_grant',
    target: `${record.discord_username} (${userId})`,
    details: finalName ? `Role: ${finalName} (MaxShare: ${resolvedMaxShares})` : `Akses /mrole (MaxShare: ${resolvedMaxShares})`,
  });

  res.status(201).json({ role: record });
});

customRolesRouter.delete('/:userId', requireRole('superadmin'), async (req: AuthenticatedRequest, res) => {
  const userId = String(req.params.userId || '').trim();
  const record = getCustomRoleByUserId(userId);
  if (!record) {
    res.status(404).json({ error: 'Data Custom Role tidak ditemukan.' });
    return;
  }

  if (record.role_id && isBotReady() && config.guildId) {
    try {
      const guild = await discordClient.guilds.fetch(config.guildId);
      const role = await guild.roles.fetch(record.role_id).catch(() => null);
      if (role) {
        await role.delete(`Dicabut oleh ${req.user!.name} melalui Web Humas`).catch(() => {});
      }
    } catch {
      // Ignore
    }
  }

  deleteCustomRoleByUserId(userId);

  logAudit({
    admin_username: req.user!.username,
    admin_name: req.user!.name,
    admin_role: req.user!.role,
    action: 'custom_role_revoke',
    target: `${record.discord_username} (${userId})`,
    details: `Menghapus Custom Role ${record.name || '(belum dibuat)'}`,
  });

  res.json({ ok: true });
});

