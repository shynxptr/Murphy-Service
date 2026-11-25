import dotenv from 'dotenv';
import path from 'node:path';
import type { AdminAccount, AdminRole } from './types.js';

dotenv.config();

function parseAdminAccounts(raw: string | undefined): AdminAccount[] {
  if (!raw || !raw.trim()) return [];
  const trimmed = raw.trim();

  // Support JSON array format
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as Array<Partial<AdminAccount>>;
      return parsed
        .filter((a) => a.username && a.password)
        .map((a) => ({
          username: String(a.username).trim(),
          password: String(a.password),
          name: String(a.name || a.username).trim(),
          role: (a.role === 'superadmin' ? 'superadmin' : 'staff') as AdminRole,
        }));
    } catch (err) {
      console.error('[Config] Gagal parse ADMIN_ACCOUNTS sebagai JSON:', err);
      return [];
    }
  }

  // Support comma-separated format: username:password:name:role
  // Note: bcrypt hashes don't contain ':' or ',' so splitting by ':' works safely.
  return trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(':');
      const username = (parts[0] || '').trim();
      const password = parts[1] || '';
      const name = (parts[2] || username).trim();
      const role: AdminRole = (parts[3] || '').trim() === 'superadmin' ? 'superadmin' : 'staff';
      return { username, password, name, role };
    })
    .filter((a) => a.username && a.password);
}

export const config = {
  discordToken: process.env.DISCORD_TOKEN || '',
  guildId: process.env.DISCORD_GUILD_ID || '',
  notifChannelId: process.env.NOTIF_CHANNEL_ID || '',
  fallbackChannelId: process.env.FALLBACK_CHANNEL_ID || '',
  partnerRoleId: process.env.PARTNER_ROLE_ID || '',
  port: Number(process.env.PORT || 3000),
  webBaseUrl: (process.env.WEB_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ''),
  jwtSecret: process.env.JWT_SECRET || 'humas-dev-secret-change-in-production',
  dbPath: path.resolve(process.env.DB_PATH || './data/humas.db'),
  uploadsDir: path.resolve(process.env.UPLOADS_DIR || './uploads'),
  removeBgApiKey: process.env.REMOVE_BG_API_KEY || '',
  adminAccounts: parseAdminAccounts(process.env.ADMIN_ACCOUNTS),
};

export function findAdminAccount(username: string): AdminAccount | undefined {
  return config.adminAccounts.find(
    (a) => a.username.toLowerCase() === username.trim().toLowerCase()
  );
}
