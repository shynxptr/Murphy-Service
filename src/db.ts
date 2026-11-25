import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import type {
  AnonMessage,
  AnonSessionInternal,
  AnonSessionPublic,
  Aspiration,
  AuditLog,
  ChannelPost,
  ChatMessage,
  Conversation,
  ConversationCategory,
  ConversationStatus,
  ConversationType,
  CustomRoleHistoryItem,
  CustomRoleRecord,
  CustomRoleSettings,
  EventInvite,
  EventRsvp,
  MediaKitSettings,
  MessageAttachment,
  MessageTemplate,
  OfficeHoursSettings,
  Partner,
  QuickContact,
  QuickContactGroup,
  Survey,
  SurveyResponse,
  Tournament,
  TournamentMode,
  TournamentNotifSettings,
  TournamentRegistration,
  WarningRecord,
} from './types.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(config.uploadsDir, { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_user_id TEXT NOT NULL UNIQUE,
    discord_username TEXT NOT NULL,
    discord_avatar TEXT,
    type TEXT NOT NULL DEFAULT 'member',
    category TEXT NOT NULL DEFAULT 'general',
    status TEXT NOT NULL DEFAULT 'open',
    fallback_thread_id TEXT,
    dm_blocked INTEGER NOT NULL DEFAULT 0,
    unread_count INTEGER NOT NULL DEFAULT 0,
    assigned_to TEXT,
    last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_message_preview TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    admin_username TEXT,
    content TEXT NOT NULL DEFAULT '',
    attachments_json TEXT NOT NULL DEFAULT '[]',
    discord_message_id TEXT,
    delivery_channel TEXT NOT NULL DEFAULT 'dm',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_name TEXT NOT NULL,
    pic_discord_id TEXT NOT NULL,
    pic_username TEXT NOT NULL,
    backup_pic_discord_id TEXT,
    backup_pic_name TEXT,
    invite_link TEXT,
    invite_status TEXT NOT NULL DEFAULT 'unknown',
    tags_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    strikes INTEGER NOT NULL DEFAULT 0,
    collaboration_history TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_discord_id TEXT NOT NULL,
    target_username TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT 'member',
    partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL,
    level INTEGER NOT NULL DEFAULT 1,
    reason TEXT NOT NULL,
    evidence_url TEXT,
    issued_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL DEFAULT 'general',
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS aspirations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_user_id TEXT NOT NULL,
    is_anonymous INTEGER NOT NULL DEFAULT 1,
    sender_label TEXT NOT NULL DEFAULT 'Anonim',
    category TEXT NOT NULL DEFAULT 'Saran',
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    admin_notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    event_date TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS event_rsvps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    pic_discord_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    responded_at TEXT,
    UNIQUE(event_id, partner_id)
  );

  CREATE TABLE IF NOT EXISTS surveys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS survey_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    discord_user_id TEXT NOT NULL,
    discord_username TEXT NOT NULL,
    rating INTEGER NOT NULL,
    feedback TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(survey_id, discord_user_id)
  );

  CREATE TABLE IF NOT EXISTS broadcast_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broadcast_id TEXT NOT NULL,
    partner_id INTEGER NOT NULL,
    pic_discord_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',
    confirmed_at TEXT,
    UNIQUE(broadcast_id, partner_id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quick_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_user_id TEXT NOT NULL UNIQUE,
    discord_username TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    group_tag TEXT NOT NULL DEFAULT 'staff',
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS channel_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    embed_title TEXT,
    content TEXT NOT NULL DEFAULT '',
    attachments_json TEXT NOT NULL DEFAULT '[]',
    discord_message_id TEXT,
    sent_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_username TEXT NOT NULL,
    admin_name TEXT NOT NULL,
    admin_role TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS custom_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_user_id TEXT NOT NULL UNIQUE,
    discord_username TEXT NOT NULL DEFAULT '',
    role_id TEXT,
    source TEXT NOT NULL DEFAULT 'booster',
    name TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#CECECE',
    side_color TEXT,
    description TEXT NOT NULL DEFAULT '',
    icon_url TEXT,
    banner_url TEXT,
    hoisted INTEGER NOT NULL DEFAULT 0,
    max_shares INTEGER NOT NULL DEFAULT 10,
    shared_with_json TEXT NOT NULL DEFAULT '[]',
    history_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS anon_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alias TEXT NOT NULL,
    discord_user_id TEXT NOT NULL,
    topic TEXT NOT NULL DEFAULT 'Curhat / Aduan',
    status TEXT NOT NULL DEFAULT 'open',
    unread_count INTEGER NOT NULL DEFAULT 0,
    last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_message_preview TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS anon_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES anon_sessions(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL,
    sender_label TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    attachments_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    game TEXT NOT NULL DEFAULT 'Umum',
    mode TEXT NOT NULL DEFAULT 'team',
    max_slots INTEGER NOT NULL DEFAULT 16,
    description TEXT NOT NULL DEFAULT '',
    participant_role_id TEXT,
    channel_id TEXT,
    message_id TEXT,
    is_open INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tournament_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    captain_discord_id TEXT NOT NULL,
    captain_username TEXT NOT NULL,
    team_name TEXT NOT NULL,
    representative_contact TEXT NOT NULL DEFAULT '',
    roster_text TEXT NOT NULL DEFAULT '',
    substitutes TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    reject_reason TEXT NOT NULL DEFAULT '',
    reviewed_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_anon_user_status ON anon_sessions(discord_user_id, status);
  CREATE INDEX IF NOT EXISTS idx_trn_reg_tid ON tournament_registrations(tournament_id);
  CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
  CREATE INDEX IF NOT EXISTS idx_warnings_target ON warnings(target_discord_id);
  CREATE INDEX IF NOT EXISTS idx_partners_pic ON partners(pic_discord_id);
`);

// Seed default templates if empty
const templateCount = db.prepare('SELECT COUNT(*) as c FROM templates').get() as { c: number };
if (templateCount.c === 0) {
  const insertTpl = db.prepare(
    'INSERT OR IGNORE INTO templates (name, category, content) VALUES (?, ?, ?)'
  );
  const defaults: Array<[string, ConversationCategory, string]> = [
    [
      'Teguran Pelanggaran',
      'warning',
      'Halo! Kami dari Tim Humas & Moderasi ingin menyampaikan peringatan resmi terkait pelanggaran aturan server:\n\n• Pelanggaran: [isi pelanggaran]\n• Tingkat Peringatan: Warn [1/2/3]\n\nMohon untuk memperhatikan kembali peraturan server agar kejadian serupa tidak terulang. Jika ada klarifikasi, silakan balas pesan ini.',
    ],
    [
      'Info Pemenang Hadiah',
      'reward',
      'Selamat! Kamu terpilih sebagai pemenang [Nama Event/Giveaway] 🎉\n\nHadiah: [Detail Hadiah]\n\nSilakan balas pesan ini dengan data klaim hadiahmu maksimal sebelum [Tanggal/Jam]. Terima kasih sudah berpartisipasi!',
    ],
    [
      'Reminder Benefit Custom Role',
      'benefit',
      'Halo! Kami ingin mengingatkan bahwa kamu memiliki benefit **Custom Role** yang belum diklaim ✨\n\nSilakan balas pesan ini dengan detail:\n• Nama Role:\n• Kode Warna (Hex):\n• Icon/Emoji (jika ada):\n\nBatas klaim sampai [Tanggal]. Ditunggu ya!',
    ],
    [
      'Salam & Broadcast Partnership',
      'partnership',
      'Halo rekan Partner! Kami dari Tim Humas ingin menginformasikan update/event terbaru dari komunitas kami:\n\n[Isi Informasi / Event]\n\nBesar harapan kami rekan-rekan dapat ikut meramaikan. Terima kasih atas kerja samanya!',
    ],
  ];
  for (const [name, category, content] of defaults) {
    insertTpl.run(name, category, content);
  }
}

// Default Office Hours setting
const defaultOfficeHours: OfficeHoursSettings = {
  enabled: false,
  timezone: 'Asia/Jakarta',
  startHour: 9,
  endHour: 21,
  activeDays: [1, 2, 3, 4, 5, 6], // Mon-Sat
  awayMessage:
    'Halo! Terima kasih sudah menghubungi Tim Humas. Pesanmu sudah kami terima, namun saat ini kami sedang di luar jam operasional (09.00–21.00 WIB). Tim kami akan segera membalas saat jam operasional dimulai.',
};

export function getOfficeHours(): OfficeHoursSettings {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('office_hours') as
    | { value: string }
    | undefined;
  if (!row) return defaultOfficeHours;
  try {
    return { ...defaultOfficeHours, ...JSON.parse(row.value) };
  } catch {
    return defaultOfficeHours;
  }
}

export function saveOfficeHours(settings: OfficeHoursSettings): OfficeHoursSettings {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run('office_hours', JSON.stringify(settings));
  return settings;
}

export function isOutsideOfficeHours(settings = getOfficeHours()): boolean {
  if (!settings.enabled) return false;
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: settings.timezone || 'Asia/Jakarta',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const wd = parts.find((p) => p.type === 'weekday')?.value || 'Mon';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || '12');
  const dayNum = weekdayMap[wd] ?? 1;

  if (!settings.activeDays.includes(dayNum)) return true;
  if (hour < settings.startHour || hour >= settings.endHour) return true;
  return false;
}

// ---- Conversations & Messages ----

export function upsertConversation(params: {
  discordUserId: string;
  discordUsername: string;
  discordAvatar?: string | null;
  type?: ConversationType;
  category?: ConversationCategory;
}): Conversation {
  const existing = db
    .prepare('SELECT * FROM conversations WHERE discord_user_id = ?')
    .get(params.discordUserId) as Conversation | undefined;

  // Auto-detect partner if registered in partners table
  const partner = db
    .prepare('SELECT id FROM partners WHERE pic_discord_id = ? OR backup_pic_discord_id = ?')
    .get(params.discordUserId, params.discordUserId) as { id: number } | undefined;
  const resolvedType: ConversationType = params.type || (partner ? 'partner' : 'member');

  if (existing) {
    db.prepare(
      `UPDATE conversations
       SET discord_username = ?, discord_avatar = COALESCE(?, discord_avatar),
           type = CASE WHEN ? = 'partner' THEN 'partner' ELSE type END,
           category = COALESCE(?, category)
       WHERE id = ?`
    ).run(
      params.discordUsername,
      params.discordAvatar ?? null,
      resolvedType,
      params.category ?? null,
      existing.id
    );
    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(existing.id) as unknown as Conversation;
  }

  const info = db
    .prepare(
      `INSERT INTO conversations (discord_user_id, discord_username, discord_avatar, type, category)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      params.discordUserId,
      params.discordUsername,
      params.discordAvatar ?? null,
      resolvedType,
      params.category || (resolvedType === 'partner' ? 'partnership' : 'general')
    );

  return db
    .prepare('SELECT * FROM conversations WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as unknown as Conversation;
}

export function listConversations(filter?: {
  type?: string;
  status?: string;
  search?: string;
}): Conversation[] {
  const clauses: string[] = [];
  const args: Array<string | number> = [];

  if (filter?.type && filter.type !== 'all') {
    clauses.push('type = ?');
    args.push(filter.type);
  }
  if (filter?.status && filter.status !== 'all') {
    clauses.push('status = ?');
    args.push(filter.status);
  }
  if (filter?.search && filter.search.trim()) {
    clauses.push('(discord_username LIKE ? OR discord_user_id LIKE ? OR last_message_preview LIKE ?)');
    const q = `%${filter.search.trim()}%`;
    args.push(q, q, q);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM conversations ${where} ORDER BY last_message_at DESC`)
    .all(...args) as unknown as Conversation[];
}

export function getConversationById(id: number): Conversation | undefined {
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as unknown as
    | Conversation
    | undefined;
}

export function getConversationByThreadId(threadId: string): Conversation | undefined {
  return db
    .prepare('SELECT * FROM conversations WHERE fallback_thread_id = ?')
    .get(threadId) as unknown as Conversation | undefined;
}

export function updateConversationMeta(
  id: number,
  updates: {
    status?: ConversationStatus;
    category?: ConversationCategory;
    assigned_to?: string | null;
    dm_blocked?: number;
    fallback_thread_id?: string | null;
    unread_count?: number;
  }
): Conversation | undefined {
  const fields: string[] = [];
  const args: Array<string | number | null> = [];

  if (updates.status !== undefined) {
    fields.push('status = ?');
    args.push(updates.status);
  }
  if (updates.category !== undefined) {
    fields.push('category = ?');
    args.push(updates.category);
  }
  if (updates.assigned_to !== undefined) {
    fields.push('assigned_to = ?');
    args.push(updates.assigned_to);
  }
  if (updates.dm_blocked !== undefined) {
    fields.push('dm_blocked = ?');
    args.push(updates.dm_blocked);
  }
  if (updates.fallback_thread_id !== undefined) {
    fields.push('fallback_thread_id = ?');
    args.push(updates.fallback_thread_id);
  }
  if (updates.unread_count !== undefined) {
    fields.push('unread_count = ?');
    args.push(updates.unread_count);
  }

  if (fields.length > 0) {
    args.push(id);
    db.prepare(`UPDATE conversations SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  }
  return getConversationById(id);
}

export function addMessage(params: {
  conversationId: number;
  senderType: 'admin' | 'user' | 'system' | 'internal_note';
  senderName: string;
  adminUsername?: string | null;
  content: string;
  attachments?: MessageAttachment[];
  discordMessageId?: string | null;
  deliveryChannel?: 'dm' | 'thread' | 'internal';
}): ChatMessage {
  const attachments = params.attachments || [];
  const info = db
    .prepare(
      `INSERT INTO messages (conversation_id, sender_type, sender_name, admin_username, content, attachments_json, discord_message_id, delivery_channel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.conversationId,
      params.senderType,
      params.senderName,
      params.adminUsername ?? null,
      params.content,
      JSON.stringify(attachments),
      params.discordMessageId ?? null,
      params.deliveryChannel || (params.senderType === 'internal_note' ? 'internal' : 'dm')
    );

  const preview =
    params.content.trim() ||
    (attachments.length > 0 ? `[Lampiran: ${attachments[0].originalName}]` : '');

  if (params.senderType === 'user') {
    db.prepare(
      `UPDATE conversations
       SET last_message_at = datetime('now'),
           last_message_preview = ?,
           unread_count = unread_count + 1,
           status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END
       WHERE id = ?`
    ).run(preview.slice(0, 120), params.conversationId);
  } else if (params.senderType === 'admin') {
    db.prepare(
      `UPDATE conversations
       SET last_message_at = datetime('now'),
           last_message_preview = ?
       WHERE id = ?`
    ).run(preview.slice(0, 120), params.conversationId);
  }

  const row = db
    .prepare('SELECT * FROM messages WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as unknown as Record<string, unknown>;
  return mapMessageRow(row);
}

function mapMessageRow(row: Record<string, unknown>): ChatMessage {
  let attachments: MessageAttachment[] = [];
  try {
    attachments = JSON.parse(String(row.attachments_json || '[]'));
  } catch {
    attachments = [];
  }
  return {
    id: Number(row.id),
    conversation_id: Number(row.conversation_id),
    sender_type: row.sender_type as ChatMessage['sender_type'],
    sender_name: String(row.sender_name),
    admin_username: row.admin_username ? String(row.admin_username) : null,
    content: String(row.content || ''),
    attachments,
    discord_message_id: row.discord_message_id ? String(row.discord_message_id) : null,
    delivery_channel: (row.delivery_channel as ChatMessage['delivery_channel']) || 'dm',
    created_at: String(row.created_at),
  };
}

export function getMessages(conversationId: number, limit = 150): ChatMessage[] {
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
       ) ORDER BY id ASC`
    )
    .all(conversationId, limit) as unknown as Array<Record<string, unknown>>;
  return rows.map(mapMessageRow);
}

// ---- Partners ----

function mapPartnerRow(row: Record<string, unknown>): Partner {
  let tags: string[] = [];
  try {
    tags = JSON.parse(String(row.tags_json || '[]'));
  } catch {
    tags = [];
  }
  return {
    id: Number(row.id),
    server_name: String(row.server_name),
    pic_discord_id: String(row.pic_discord_id),
    pic_username: String(row.pic_username),
    backup_pic_discord_id: row.backup_pic_discord_id ? String(row.backup_pic_discord_id) : null,
    backup_pic_name: row.backup_pic_name ? String(row.backup_pic_name) : null,
    invite_link: row.invite_link ? String(row.invite_link) : null,
    invite_status: (row.invite_status as Partner['invite_status']) || 'unknown',
    tags,
    status: (row.status as Partner['status']) || 'active',
    strikes: Number(row.strikes || 0),
    collaboration_history: String(row.collaboration_history || ''),
    notes: String(row.notes || ''),
    joined_at: String(row.joined_at),
    updated_at: String(row.updated_at),
  };
}

export function listPartners(): Partner[] {
  const rows = db
    .prepare('SELECT * FROM partners ORDER BY status ASC, server_name ASC')
    .all() as unknown as Array<Record<string, unknown>>;
  return rows.map(mapPartnerRow);
}

export function getPartnerById(id: number): Partner | undefined {
  const row = db.prepare('SELECT * FROM partners WHERE id = ?').get(id) as unknown as
    | Record<string, unknown>
    | undefined;
  return row ? mapPartnerRow(row) : undefined;
}

export function findPartnersByPicId(discordUserId: string): Partner[] {
  const rows = db
    .prepare('SELECT * FROM partners WHERE pic_discord_id = ? OR backup_pic_discord_id = ?')
    .all(discordUserId, discordUserId) as unknown as Array<Record<string, unknown>>;
  return rows.map(mapPartnerRow);
}

export function createPartner(data: {
  server_name: string;
  pic_discord_id: string;
  pic_username: string;
  backup_pic_discord_id?: string | null;
  backup_pic_name?: string | null;
  invite_link?: string | null;
  tags?: string[];
  status?: Partner['status'];
  collaboration_history?: string;
  notes?: string;
}): Partner {
  const info = db
    .prepare(
      `INSERT INTO partners (
        server_name, pic_discord_id, pic_username,
        backup_pic_discord_id, backup_pic_name,
        invite_link, tags_json, status, collaboration_history, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.server_name,
      data.pic_discord_id,
      data.pic_username,
      data.backup_pic_discord_id || null,
      data.backup_pic_name || null,
      data.invite_link || null,
      JSON.stringify(data.tags || []),
      data.status || 'active',
      data.collaboration_history || '',
      data.notes || ''
    );

  // Sync existing conversation type to partner if any
  db.prepare("UPDATE conversations SET type = 'partner' WHERE discord_user_id = ?").run(
    data.pic_discord_id
  );

  return getPartnerById(Number(info.lastInsertRowid))!;
}

export function updatePartner(
  id: number,
  data: Partial<{
    server_name: string;
    pic_discord_id: string;
    pic_username: string;
    backup_pic_discord_id: string | null;
    backup_pic_name: string | null;
    invite_link: string | null;
    invite_status: Partner['invite_status'];
    tags: string[];
    status: Partner['status'];
    strikes: number;
    collaboration_history: string;
    notes: string;
  }>
): Partner | undefined {
  const fields: string[] = ["updated_at = datetime('now')"];
  const args: Array<string | number | null> = [];

  if (data.server_name !== undefined) {
    fields.push('server_name = ?');
    args.push(data.server_name);
  }
  if (data.pic_discord_id !== undefined) {
    fields.push('pic_discord_id = ?');
    args.push(data.pic_discord_id);
  }
  if (data.pic_username !== undefined) {
    fields.push('pic_username = ?');
    args.push(data.pic_username);
  }
  if (data.backup_pic_discord_id !== undefined) {
    fields.push('backup_pic_discord_id = ?');
    args.push(data.backup_pic_discord_id);
  }
  if (data.backup_pic_name !== undefined) {
    fields.push('backup_pic_name = ?');
    args.push(data.backup_pic_name);
  }
  if (data.invite_link !== undefined) {
    fields.push('invite_link = ?');
    args.push(data.invite_link);
  }
  if (data.invite_status !== undefined) {
    fields.push('invite_status = ?');
    args.push(data.invite_status);
  }
  if (data.tags !== undefined) {
    fields.push('tags_json = ?');
    args.push(JSON.stringify(data.tags));
  }
  if (data.status !== undefined) {
    fields.push('status = ?');
    args.push(data.status);
  }
  if (data.strikes !== undefined) {
    fields.push('strikes = ?');
    args.push(data.strikes);
  }
  if (data.collaboration_history !== undefined) {
    fields.push('collaboration_history = ?');
    args.push(data.collaboration_history);
  }
  if (data.notes !== undefined) {
    fields.push('notes = ?');
    args.push(data.notes);
  }

  args.push(id);
  db.prepare(`UPDATE partners SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  return getPartnerById(id);
}

export function deletePartner(id: number): void {
  db.prepare('DELETE FROM partners WHERE id = ?').run(id);
}

// ---- Warnings ----

export function createWarning(data: {
  target_discord_id: string;
  target_username: string;
  target_type: 'member' | 'partner';
  partner_id?: number | null;
  level: number;
  reason: string;
  evidence_url?: string | null;
  issued_by: string;
}): WarningRecord {
  const info = db
    .prepare(
      `INSERT INTO warnings (target_discord_id, target_username, target_type, partner_id, level, reason, evidence_url, issued_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.target_discord_id,
      data.target_username,
      data.target_type,
      data.partner_id ?? null,
      data.level,
      data.reason,
      data.evidence_url ?? null,
      data.issued_by
    );

  if (data.partner_id) {
    db.prepare('UPDATE partners SET strikes = strikes + 1, updated_at = datetime(\'now\') WHERE id = ?').run(
      data.partner_id
    );
  }

  return db
    .prepare('SELECT * FROM warnings WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as unknown as WarningRecord;
}

export function listWarnings(targetDiscordId?: string): WarningRecord[] {
  if (targetDiscordId) {
    return db
      .prepare('SELECT * FROM warnings WHERE target_discord_id = ? ORDER BY id DESC')
      .all(targetDiscordId) as unknown as WarningRecord[];
  }
  return db
    .prepare('SELECT * FROM warnings ORDER BY id DESC LIMIT 300')
    .all() as unknown as WarningRecord[];
}

export function deleteWarning(id: number): void {
  db.prepare('DELETE FROM warnings WHERE id = ?').run(id);
}

// ---- Templates ----

export function listTemplates(): MessageTemplate[] {
  return db.prepare('SELECT * FROM templates ORDER BY category ASC, name ASC').all() as unknown as MessageTemplate[];
}

export function createTemplate(name: string, category: ConversationCategory, content: string): MessageTemplate {
  const info = db
    .prepare('INSERT INTO templates (name, category, content) VALUES (?, ?, ?)')
    .run(name, category, content);
  return db
    .prepare('SELECT * FROM templates WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as unknown as MessageTemplate;
}

export function updateTemplate(
  id: number,
  name: string,
  category: ConversationCategory,
  content: string
): MessageTemplate | undefined {
  db.prepare('UPDATE templates SET name = ?, category = ?, content = ? WHERE id = ?').run(
    name,
    category,
    content,
    id
  );
  return db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as unknown as
    | MessageTemplate
    | undefined;
}

export function deleteTemplate(id: number): void {
  db.prepare('DELETE FROM templates WHERE id = ?').run(id);
}

// ---- Aspirations (Kotak Saran) ----

export function createAspiration(data: {
  discord_user_id: string;
  is_anonymous: boolean;
  sender_label: string;
  category: string;
  content: string;
}): Aspiration {
  const info = db
    .prepare(
      `INSERT INTO aspirations (discord_user_id, is_anonymous, sender_label, category, content)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      data.discord_user_id,
      data.is_anonymous ? 1 : 0,
      data.sender_label,
      data.category,
      data.content
    );
  return db
    .prepare('SELECT * FROM aspirations WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as unknown as Aspiration;
}

export function listAspirations(): Aspiration[] {
  return db.prepare('SELECT * FROM aspirations ORDER BY id DESC').all() as unknown as Aspiration[];
}

export function updateAspiration(
  id: number,
  status: Aspiration['status'],
  adminNotes: string
): Aspiration | undefined {
  db.prepare('UPDATE aspirations SET status = ?, admin_notes = ? WHERE id = ?').run(
    status,
    adminNotes,
    id
  );
  return db.prepare('SELECT * FROM aspirations WHERE id = ?').get(id) as unknown as
    | Aspiration
    | undefined;
}

// ---- Events & Partner RSVP ----

export function createEventInvite(data: {
  title: string;
  description: string;
  event_date: string;
  created_by: string;
}): EventInvite {
  const info = db
    .prepare('INSERT INTO events (title, description, event_date, created_by) VALUES (?, ?, ?, ?)')
    .run(data.title, data.description, data.event_date, data.created_by);
  return db
    .prepare('SELECT * FROM events WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as unknown as EventInvite;
}

export function upsertEventRsvp(
  eventId: number,
  partnerId: number,
  picDiscordId: string,
  status: EventRsvp['status']
): void {
  const responded = status === 'pending' || status === 'failed' ? null : new Date().toISOString();
  db.prepare(
    `INSERT INTO event_rsvps (event_id, partner_id, pic_discord_id, status, responded_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(event_id, partner_id) DO UPDATE SET status = excluded.status, responded_at = excluded.responded_at`
  ).run(eventId, partnerId, picDiscordId, status, responded);
}

export function listEventsWithRsvps(): EventInvite[] {
  const events = db.prepare('SELECT * FROM events ORDER BY id DESC').all() as unknown as EventInvite[];
  const rsvpStmt = db.prepare(`
    SELECT r.*, p.server_name, p.pic_username
    FROM event_rsvps r
    JOIN partners p ON p.id = r.partner_id
    WHERE r.event_id = ?
    ORDER BY r.id ASC
  `);
  return events.map((ev) => ({
    ...ev,
    rsvps: rsvpStmt.all(ev.id) as unknown as EventRsvp[],
  }));
}

// ---- Surveys (Evaluasi Event) ----

export function createSurvey(title: string, description: string, createdBy: string): Survey {
  const info = db
    .prepare('INSERT INTO surveys (title, description, created_by) VALUES (?, ?, ?)')
    .run(title, description, createdBy);
  return db
    .prepare('SELECT * FROM surveys WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as unknown as Survey;
}

export function listSurveys(): Survey[] {
  return db
    .prepare(
      `SELECT s.*,
        COUNT(r.id) as response_count,
        ROUND(AVG(r.rating), 2) as avg_rating
       FROM surveys s
       LEFT JOIN survey_responses r ON r.survey_id = s.id
       GROUP BY s.id
       ORDER BY s.id DESC`
    )
    .all() as unknown as Survey[];
}

export function getActiveSurvey(): Survey | undefined {
  return db
    .prepare('SELECT * FROM surveys WHERE is_active = 1 ORDER BY id DESC LIMIT 1')
    .get() as unknown as Survey | undefined;
}

export function toggleSurveyActive(id: number, isActive: boolean): void {
  db.prepare('UPDATE surveys SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, id);
}

export function submitSurveyResponse(data: {
  survey_id: number;
  discord_user_id: string;
  discord_username: string;
  rating: number;
  feedback: string;
}): void {
  db.prepare(
    `INSERT INTO survey_responses (survey_id, discord_user_id, discord_username, rating, feedback)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(survey_id, discord_user_id)
     DO UPDATE SET rating = excluded.rating, feedback = excluded.feedback, created_at = datetime('now')`
  ).run(data.survey_id, data.discord_user_id, data.discord_username, data.rating, data.feedback);
}

export function listSurveyResponses(surveyId: number): SurveyResponse[] {
  return db
    .prepare('SELECT * FROM survey_responses WHERE survey_id = ? ORDER BY id DESC')
    .all(surveyId) as unknown as SurveyResponse[];
}

// ---- Broadcast Read Receipts ----

export function recordBroadcastReceipt(
  broadcastId: string,
  partnerId: number,
  picDiscordId: string,
  status: 'sent' | 'failed' | 'confirmed' | 'declined'
): void {
  const confirmedAt = status === 'confirmed' || status === 'declined' ? new Date().toISOString() : null;
  db.prepare(
    `INSERT INTO broadcast_receipts (broadcast_id, partner_id, pic_discord_id, status, confirmed_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(broadcast_id, partner_id)
     DO UPDATE SET status = excluded.status, confirmed_at = COALESCE(excluded.confirmed_at, broadcast_receipts.confirmed_at)`
  ).run(broadcastId, partnerId, picDiscordId, status, confirmedAt);
}

// ---- Quick Contacts (Quick Chat & Staff Reminders) ----

export function listQuickContacts(): QuickContact[] {
  return db
    .prepare('SELECT * FROM quick_contacts ORDER BY group_tag ASC, label ASC, discord_username ASC')
    .all() as unknown as QuickContact[];
}

export function getQuickContactById(id: number): QuickContact | undefined {
  return db.prepare('SELECT * FROM quick_contacts WHERE id = ?').get(id) as unknown as
    | QuickContact
    | undefined;
}

export function upsertQuickContact(data: {
  discord_user_id: string;
  discord_username: string;
  label?: string;
  group_tag?: QuickContactGroup;
  notes?: string;
  created_by: string;
}): QuickContact {
  db.prepare(
    `INSERT INTO quick_contacts (discord_user_id, discord_username, label, group_tag, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(discord_user_id) DO UPDATE SET
       discord_username = excluded.discord_username,
       label = excluded.label,
       group_tag = excluded.group_tag,
       notes = excluded.notes`
  ).run(
    data.discord_user_id,
    data.discord_username,
    data.label?.trim() || data.discord_username,
    data.group_tag || 'staff',
    data.notes?.trim() || '',
    data.created_by
  );

  return db
    .prepare('SELECT * FROM quick_contacts WHERE discord_user_id = ?')
    .get(data.discord_user_id) as unknown as QuickContact;
}

export function deleteQuickContact(id: number): void {
  db.prepare('DELETE FROM quick_contacts WHERE id = ?').run(id);
}

// ---- Channel Posts ----

export function addChannelPost(data: {
  channel_id: string;
  channel_name: string;
  embed_title?: string | null;
  content: string;
  attachments?: MessageAttachment[];
  discord_message_id?: string | null;
  sent_by: string;
}): ChannelPost {
  const attachments = data.attachments || [];
  const info = db
    .prepare(
      `INSERT INTO channel_posts (channel_id, channel_name, embed_title, content, attachments_json, discord_message_id, sent_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.channel_id,
      data.channel_name,
      data.embed_title || null,
      data.content,
      JSON.stringify(attachments),
      data.discord_message_id || null,
      data.sent_by
    );

  const row = db
    .prepare('SELECT * FROM channel_posts WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as unknown as Record<string, unknown>;
  return mapChannelPostRow(row);
}

function mapChannelPostRow(row: Record<string, unknown>): ChannelPost {
  let attachments: MessageAttachment[] = [];
  try {
    attachments = JSON.parse(String(row.attachments_json || '[]'));
  } catch {
    attachments = [];
  }
  return {
    id: Number(row.id),
    channel_id: String(row.channel_id),
    channel_name: String(row.channel_name),
    embed_title: row.embed_title ? String(row.embed_title) : null,
    content: String(row.content || ''),
    attachments,
    discord_message_id: row.discord_message_id ? String(row.discord_message_id) : null,
    sent_by: String(row.sent_by),
    created_at: String(row.created_at),
  };
}

export function listChannelPosts(limit = 50): ChannelPost[] {
  const rows = db
    .prepare('SELECT * FROM channel_posts ORDER BY id DESC LIMIT ?')
    .all(limit) as unknown as Array<Record<string, unknown>>;
  return rows.map(mapChannelPostRow);
}

// ---- Audit Logs ----

export function logAudit(data: {
  admin_username: string;
  admin_name: string;
  admin_role: string;
  action: string;
  target?: string;
  details?: string;
}): void {
  db.prepare(
    `INSERT INTO audit_logs (admin_username, admin_name, admin_role, action, target, details)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    data.admin_username,
    data.admin_name,
    data.admin_role,
    data.action,
    data.target || '',
    data.details || ''
  );
}

export function listAuditLogs(filter?: {
  action?: string;
  search?: string;
  limit?: number;
}): AuditLog[] {
  const clauses: string[] = [];
  const args: Array<string | number> = [];

  if (filter?.action && filter.action !== 'all') {
    clauses.push('action = ?');
    args.push(filter.action);
  }
  if (filter?.search && filter.search.trim()) {
    clauses.push('(admin_name LIKE ? OR admin_username LIKE ? OR target LIKE ? OR details LIKE ?)');
    const q = `%${filter.search.trim()}%`;
    args.push(q, q, q, q);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = filter?.limit || 200;
  args.push(limit);

  return db
    .prepare(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ?`)
    .all(...args) as unknown as AuditLog[];
}

// ---- Media Kit Settings ----

const defaultMediaKit: MediaKitSettings = {
  serverName: 'Komunitas Kami',
  description:
    'Komunitas aktif yang terbuka untuk kolaborasi event, media partner, dan partnership jangka panjang.',
  requirements:
    '• Server aktif & ramah (SFW)\n• Bersedia saling repost pengumuman event/partnership\n• PIC tetap berada di server selama masa partnership',
  inviteLink: '',
  logoUrl: '',
  bannerUrl: '',
};

export function getMediaKit(): MediaKitSettings {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('media_kit') as
    | { value: string }
    | undefined;
  if (!row) return defaultMediaKit;
  try {
    return { ...defaultMediaKit, ...JSON.parse(row.value) };
  } catch {
    return defaultMediaKit;
  }
}

export function saveMediaKit(settings: MediaKitSettings): MediaKitSettings {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run('media_kit', JSON.stringify(settings));
  return settings;
}

// ---- Custom Role Settings & Records (Booster + Admin Grant) ----

const defaultCustomRoleSettings: CustomRoleSettings = {
  enabled: true,
  anchorRoleId: '',
  defaultMaxShares: 10,
  allowHoist: false,
};

export function getCustomRoleSettings(): CustomRoleSettings {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('custom_role_settings') as
    | { value: string }
    | undefined;
  if (!row) return defaultCustomRoleSettings;
  try {
    return { ...defaultCustomRoleSettings, ...JSON.parse(row.value) };
  } catch {
    return defaultCustomRoleSettings;
  }
}

export function saveCustomRoleSettings(settings: CustomRoleSettings): CustomRoleSettings {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run('custom_role_settings', JSON.stringify(settings));
  return settings;
}

function mapCustomRoleRow(row: Record<string, unknown>): CustomRoleRecord {
  let sharedWith: string[] = [];
  let history: CustomRoleHistoryItem[] = [];
  try {
    sharedWith = JSON.parse(String(row.shared_with_json || '[]'));
  } catch {
    sharedWith = [];
  }
  try {
    history = JSON.parse(String(row.history_json || '[]'));
  } catch {
    history = [];
  }
  return {
    id: Number(row.id),
    discord_user_id: String(row.discord_user_id),
    discord_username: String(row.discord_username || ''),
    role_id: row.role_id ? String(row.role_id) : null,
    source: row.source === 'admin_grant' ? 'admin_grant' : 'booster',
    name: String(row.name || ''),
    color: String(row.color || '#CECECE'),
    side_color: row.side_color ? String(row.side_color) : null,
    description: String(row.description || ''),
    icon_url: row.icon_url ? String(row.icon_url) : null,
    banner_url: row.banner_url ? String(row.banner_url) : null,
    hoisted: Number(row.hoisted || 0),
    max_shares: Number(row.max_shares ?? 10),
    shared_with: sharedWith,
    history,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function listCustomRoles(): CustomRoleRecord[] {
  const rows = db
    .prepare('SELECT * FROM custom_roles ORDER BY updated_at DESC')
    .all() as unknown as Array<Record<string, unknown>>;
  return rows.map(mapCustomRoleRow);
}

export function getCustomRoleByUserId(discordUserId: string): CustomRoleRecord | undefined {
  const row = db
    .prepare('SELECT * FROM custom_roles WHERE discord_user_id = ?')
    .get(discordUserId) as unknown as Record<string, unknown> | undefined;
  return row ? mapCustomRoleRow(row) : undefined;
}

export function upsertCustomRole(data: {
  discord_user_id: string;
  discord_username?: string;
  role_id?: string | null;
  source?: 'booster' | 'admin_grant';
  name?: string;
  color?: string;
  side_color?: string | null;
  description?: string;
  icon_url?: string | null;
  banner_url?: string | null;
  hoisted?: number;
  max_shares?: number;
  shared_with?: string[];
  history?: CustomRoleHistoryItem[];
}): CustomRoleRecord {
  const existing = getCustomRoleByUserId(data.discord_user_id);
  const cfg = getCustomRoleSettings();

  const merged = {
    discord_user_id: data.discord_user_id,
    discord_username: data.discord_username ?? existing?.discord_username ?? '',
    role_id: data.role_id !== undefined ? data.role_id : existing?.role_id ?? null,
    source: data.source ?? existing?.source ?? 'booster',
    name: data.name ?? existing?.name ?? '',
    color: data.color ?? existing?.color ?? '#CECECE',
    side_color: data.side_color !== undefined ? data.side_color : existing?.side_color ?? null,
    description: data.description ?? existing?.description ?? '',
    icon_url: data.icon_url !== undefined ? data.icon_url : existing?.icon_url ?? null,
    banner_url: data.banner_url !== undefined ? data.banner_url : existing?.banner_url ?? null,
    hoisted: data.hoisted !== undefined ? data.hoisted : existing?.hoisted ?? 0,
    max_shares: data.max_shares !== undefined ? data.max_shares : existing?.max_shares ?? cfg.defaultMaxShares,
    shared_with: data.shared_with ?? existing?.shared_with ?? [],
    history: data.history ?? existing?.history ?? [],
  };

  db.prepare(
    `INSERT INTO custom_roles (
      discord_user_id, discord_username, role_id, source,
      name, color, side_color, description, icon_url, banner_url,
      hoisted, max_shares, shared_with_json, history_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(discord_user_id) DO UPDATE SET
      discord_username = excluded.discord_username,
      role_id = excluded.role_id,
      source = excluded.source,
      name = excluded.name,
      color = excluded.color,
      side_color = excluded.side_color,
      description = excluded.description,
      icon_url = excluded.icon_url,
      banner_url = excluded.banner_url,
      hoisted = excluded.hoisted,
      max_shares = excluded.max_shares,
      shared_with_json = excluded.shared_with_json,
      history_json = excluded.history_json,
      updated_at = datetime('now')`
  ).run(
    merged.discord_user_id,
    merged.discord_username,
    merged.role_id,
    merged.source,
    merged.name,
    merged.color,
    merged.side_color,
    merged.description,
    merged.icon_url,
    merged.banner_url,
    merged.hoisted,
    merged.max_shares,
    JSON.stringify(merged.shared_with),
    JSON.stringify(merged.history.slice(-25))
  );

  return getCustomRoleByUserId(data.discord_user_id)!;
}

export function appendCustomRoleHistory(discordUserId: string, action: string): void {
  const existing = getCustomRoleByUserId(discordUserId);
  if (!existing) return;
  const nextHistory = [...existing.history, { action, timestamp: Date.now() }].slice(-25);
  db.prepare("UPDATE custom_roles SET history_json = ?, updated_at = datetime('now') WHERE discord_user_id = ?").run(
    JSON.stringify(nextHistory),
    discordUserId
  );
}

export function deleteCustomRoleByUserId(discordUserId: string): void {
  db.prepare('DELETE FROM custom_roles WHERE discord_user_id = ?').run(discordUserId);
}

// ---- Overview Dashboard Stats ----

export function getOverviewStats() {
  const unreadConversations = (
    db.prepare('SELECT COUNT(*) as c FROM conversations WHERE unread_count > 0').get() as { c: number }
  ).c;
  const totalConversations = (
    db.prepare('SELECT COUNT(*) as c FROM conversations').get() as { c: number }
  ).c;
  const followUpCount = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM conversations
         WHERE category IN ('reward', 'benefit')
           AND status = 'waiting_reply'
           AND datetime(last_message_at) <= datetime('now', '-3 days')`
      )
      .get() as { c: number }
  ).c;
  const activePartners = (
    db.prepare("SELECT COUNT(*) as c FROM partners WHERE status = 'active'").get() as { c: number }
  ).c;
  const invalidInvites = (
    db
      .prepare("SELECT COUNT(*) as c FROM partners WHERE status = 'active' AND invite_status = 'invalid'")
      .get() as { c: number }
  ).c;
  const warningsThisMonth = (
    db
      .prepare("SELECT COUNT(*) as c FROM warnings WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')")
      .get() as { c: number }
  ).c;
  const newAspirations = (
    db.prepare("SELECT COUNT(*) as c FROM aspirations WHERE status = 'new'").get() as { c: number }
  ).c;
  const activeCustomRoles = (
    db.prepare('SELECT COUNT(*) as c FROM custom_roles WHERE role_id IS NOT NULL').get() as { c: number }
  ).c;
  const surveySummary = db
    .prepare('SELECT COUNT(*) as responses, ROUND(AVG(rating), 2) as avg_rating FROM survey_responses')
    .get() as { responses: number; avg_rating: number | null };

  const followUpList = db
    .prepare(
      `SELECT * FROM conversations
       WHERE category IN ('reward', 'benefit')
         AND status = 'waiting_reply'
         AND datetime(last_message_at) <= datetime('now', '-3 days')
       ORDER BY last_message_at ASC
       LIMIT 10`
    )
    .all() as unknown as Conversation[];

  return {
    unreadConversations,
    totalConversations,
    followUpCount,
    activePartners,
    invalidInvites,
    warningsThisMonth,
    newAspirations,
    activeCustomRoles,
    surveyResponses: surveySummary.responses || 0,
    surveyAvgRating: surveySummary.avg_rating || null,
    followUpList,
  };
}

// ---- Anonymous 2-Way Chat (Curhat / Aduan) ----

export function toPublicAnonSession(row: AnonSessionInternal): AnonSessionPublic {
  return {
    id: row.id,
    alias: row.alias,
    topic: row.topic,
    status: row.status,
    unread_count: row.unread_count,
    last_message_at: row.last_message_at,
    last_message_preview: row.last_message_preview,
    created_at: row.created_at,
  };
}

export function getActiveAnonSessionByUserId(discordUserId: string): AnonSessionInternal | undefined {
  return db
    .prepare("SELECT * FROM anon_sessions WHERE discord_user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1")
    .get(discordUserId) as unknown as AnonSessionInternal | undefined;
}

export function getAnonSessionInternalById(id: number): AnonSessionInternal | undefined {
  return db
    .prepare('SELECT * FROM anon_sessions WHERE id = ?')
    .get(id) as unknown as AnonSessionInternal | undefined;
}

export function createAnonSession(discordUserId: string, topic: string): AnonSessionInternal {
  const code = Math.floor(1000 + Math.random() * 9000);
  const alias = `Anon #${code}`;
  const info = db
    .prepare('INSERT INTO anon_sessions (alias, discord_user_id, topic) VALUES (?, ?, ?)')
    .run(alias, discordUserId, topic.trim() || 'Curhat / Aduan');
  return getAnonSessionInternalById(Number(info.lastInsertRowid))!;
}

export function listAnonSessions(status?: string): AnonSessionPublic[] {
  const rows =
    status && status !== 'all'
      ? (db
          .prepare('SELECT * FROM anon_sessions WHERE status = ? ORDER BY last_message_at DESC')
          .all(status) as unknown as AnonSessionInternal[])
      : (db
          .prepare('SELECT * FROM anon_sessions ORDER BY status DESC, last_message_at DESC')
          .all() as unknown as AnonSessionInternal[]);
  return rows.map(toPublicAnonSession);
}

export function markAnonSessionRead(id: number): AnonSessionPublic | undefined {
  db.prepare('UPDATE anon_sessions SET unread_count = 0 WHERE id = ?').run(id);
  const row = getAnonSessionInternalById(id);
  return row ? toPublicAnonSession(row) : undefined;
}

export function closeAnonSession(id: number): AnonSessionPublic | undefined {
  db.prepare("UPDATE anon_sessions SET status = 'closed', unread_count = 0 WHERE id = ?").run(id);
  const row = getAnonSessionInternalById(id);
  return row ? toPublicAnonSession(row) : undefined;
}

function mapAnonMessageRow(row: Record<string, unknown>): AnonMessage {
  let attachments: MessageAttachment[] = [];
  try {
    attachments = JSON.parse(String(row.attachments_json || '[]'));
  } catch {
    attachments = [];
  }
  return {
    id: Number(row.id),
    session_id: Number(row.session_id),
    sender_type: row.sender_type as AnonMessage['sender_type'],
    sender_label: String(row.sender_label),
    content: String(row.content || ''),
    attachments,
    created_at: String(row.created_at),
  };
}

export function addAnonMessage(params: {
  sessionId: number;
  senderType: 'anon' | 'admin' | 'system';
  senderLabel: string;
  content: string;
  attachments?: MessageAttachment[];
}): AnonMessage {
  const attachments = params.attachments || [];
  const info = db
    .prepare(
      `INSERT INTO anon_messages (session_id, sender_type, sender_label, content, attachments_json)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      params.sessionId,
      params.senderType,
      params.senderLabel,
      params.content,
      JSON.stringify(attachments)
    );

  const preview =
    params.content.trim() ||
    (attachments.length > 0 ? `[Lampiran: ${attachments[0].originalName}]` : '');

  if (params.senderType === 'anon') {
    db.prepare(
      `UPDATE anon_sessions
       SET last_message_at = datetime('now'),
           last_message_preview = ?,
           unread_count = unread_count + 1
       WHERE id = ?`
    ).run(preview.slice(0, 120), params.sessionId);
  } else if (params.senderType === 'admin') {
    db.prepare(
      `UPDATE anon_sessions
       SET last_message_at = datetime('now'),
           last_message_preview = ?,
           unread_count = 0
       WHERE id = ?`
    ).run(preview.slice(0, 120), params.sessionId);
  }

  const row = db
    .prepare('SELECT * FROM anon_messages WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as unknown as Record<string, unknown>;
  return mapAnonMessageRow(row);
}

export function listAnonMessages(sessionId: number, limit = 150): AnonMessage[] {
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT * FROM anon_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?
       ) ORDER BY id ASC`
    )
    .all(sessionId, limit) as unknown as Array<Record<string, unknown>>;
  return rows.map(mapAnonMessageRow);
}

// ---- Tournaments & Registrations ----

const defaultTournamentNotif: TournamentNotifSettings = {
  announceChannelId: '',
  sendDm: true,
  approveMessage:
    '🎉 Selamat! Pendaftaran **{tim}** untuk turnamen **{turnamen}** telah **DISETUJUI (APPROVED)** oleh Tim Humas. Silakan pantau info jadwal & technical meeting ya!',
  rejectMessage:
    'Mohon maaf, pendaftaran **{tim}** untuk turnamen **{turnamen}** belum dapat disetujui.\n**Alasan:** {alasan}\n\nSilakan perbaiki data dan daftar ulang jika slot masih tersedia.',
};

export function getTournamentNotifSettings(): TournamentNotifSettings {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('tournament_notif') as { value: string } | undefined;
  if (!row) return defaultTournamentNotif;
  try {
    return { ...defaultTournamentNotif, ...JSON.parse(row.value) };
  } catch {
    return defaultTournamentNotif;
  }
}

export function saveTournamentNotifSettings(
  updates: Partial<TournamentNotifSettings>
): TournamentNotifSettings {
  const current = getTournamentNotifSettings();
  const next: TournamentNotifSettings = {
    announceChannelId:
      updates.announceChannelId !== undefined
        ? updates.announceChannelId.trim()
        : current.announceChannelId,
    sendDm: updates.sendDm !== undefined ? Boolean(updates.sendDm) : current.sendDm,
    approveMessage:
      updates.approveMessage !== undefined && updates.approveMessage.trim()
        ? updates.approveMessage.trim()
        : current.approveMessage,
    rejectMessage:
      updates.rejectMessage !== undefined && updates.rejectMessage.trim()
        ? updates.rejectMessage.trim()
        : current.rejectMessage,
  };
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run('tournament_notif', JSON.stringify(next));
  return next;
}

export function createTournament(data: {
  title: string;
  game: string;
  mode: TournamentMode;
  max_slots: number;
  description?: string;
  participant_role_id?: string | null;
  created_by: string;
}): Tournament {
  const info = db
    .prepare(
      `INSERT INTO tournaments (title, game, mode, max_slots, description, participant_role_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.title,
      data.game,
      data.mode,
      data.max_slots,
      data.description || '',
      data.participant_role_id || null,
      data.created_by
    );
  return getTournamentById(Number(info.lastInsertRowid))!;
}

export function getTournamentById(id: number): Tournament | undefined {
  return db
    .prepare(
      `SELECT t.*,
        (SELECT COUNT(*) FROM tournament_registrations r WHERE r.tournament_id = t.id AND r.status = 'approved') as approved_count,
        (SELECT COUNT(*) FROM tournament_registrations r WHERE r.tournament_id = t.id AND r.status = 'pending') as pending_count
       FROM tournaments t WHERE t.id = ?`
    )
    .get(id) as unknown as Tournament | undefined;
}

export function listTournaments(): Tournament[] {
  return db
    .prepare(
      `SELECT t.*,
        (SELECT COUNT(*) FROM tournament_registrations r WHERE r.tournament_id = t.id AND r.status = 'approved') as approved_count,
        (SELECT COUNT(*) FROM tournament_registrations r WHERE r.tournament_id = t.id AND r.status = 'pending') as pending_count
       FROM tournaments t ORDER BY t.id DESC`
    )
    .all() as unknown as Tournament[];
}

export function updateTournamentPanelMessage(
  id: number,
  channelId: string,
  messageId: string
): void {
  db.prepare('UPDATE tournaments SET channel_id = ?, message_id = ? WHERE id = ?').run(
    channelId,
    messageId,
    id
  );
}

export function toggleTournamentOpen(id: number, isOpen: boolean): Tournament | undefined {
  db.prepare('UPDATE tournaments SET is_open = ? WHERE id = ?').run(isOpen ? 1 : 0, id);
  return getTournamentById(id);
}

export function deleteTournament(id: number): void {
  db.prepare('DELETE FROM tournaments WHERE id = ?').run(id);
}

export function createTournamentRegistration(data: {
  tournament_id: number;
  captain_discord_id: string;
  captain_username: string;
  team_name: string;
  representative_contact: string;
  roster_text: string;
  substitutes?: string;
  notes?: string;
}): TournamentRegistration {
  const info = db
    .prepare(
      `INSERT INTO tournament_registrations (
        tournament_id, captain_discord_id, captain_username,
        team_name, representative_contact, roster_text, substitutes, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.tournament_id,
      data.captain_discord_id,
      data.captain_username,
      data.team_name,
      data.representative_contact,
      data.roster_text,
      data.substitutes || '',
      data.notes || ''
    );
  return getTournamentRegistrationById(Number(info.lastInsertRowid))!;
}

export function getTournamentRegistrationById(id: number): TournamentRegistration | undefined {
  return db
    .prepare('SELECT * FROM tournament_registrations WHERE id = ?')
    .get(id) as unknown as TournamentRegistration | undefined;
}

export function findExistingRegistration(
  tournamentId: number,
  captainDiscordId: string
): TournamentRegistration | undefined {
  return db
    .prepare(
      "SELECT * FROM tournament_registrations WHERE tournament_id = ? AND captain_discord_id = ? AND status != 'rejected' LIMIT 1"
    )
    .get(tournamentId, captainDiscordId) as unknown as TournamentRegistration | undefined;
}

export function listTournamentRegistrations(tournamentId: number): TournamentRegistration[] {
  return db
    .prepare('SELECT * FROM tournament_registrations WHERE tournament_id = ? ORDER BY id DESC')
    .all(tournamentId) as unknown as TournamentRegistration[];
}

export function updateTournamentRegistrationStatus(
  regId: number,
  status: 'approved' | 'rejected' | 'pending',
  reviewedBy: string,
  rejectReason = ''
): TournamentRegistration | undefined {
  db.prepare(
    'UPDATE tournament_registrations SET status = ?, reviewed_by = ?, reject_reason = ? WHERE id = ?'
  ).run(status, reviewedBy, rejectReason, regId);
  return getTournamentRegistrationById(regId);
}
