export type AdminRole = 'superadmin' | 'staff';

export interface AuthUser {
  username: string;
  name: string;
  role: AdminRole;
}

export type ConversationType = 'partner' | 'member';
export type ConversationCategory = 'general' | 'partnership' | 'warning' | 'reward' | 'benefit';
export type ConversationStatus = 'open' | 'waiting_reply' | 'in_progress' | 'resolved';

export interface Conversation {
  id: number;
  discord_user_id: string;
  discord_username: string;
  discord_avatar: string | null;
  type: ConversationType;
  category: ConversationCategory;
  status: ConversationStatus;
  fallback_thread_id: string | null;
  dm_blocked: number;
  unread_count: number;
  assigned_to: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  created_at: string;
}

export interface MessageAttachment {
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
}

export interface ChatMessage {
  id: number;
  conversation_id: number;
  sender_type: 'admin' | 'user' | 'system' | 'internal_note';
  sender_name: string;
  admin_username: string | null;
  content: string;
  attachments: MessageAttachment[];
  discord_message_id: string | null;
  delivery_channel: 'dm' | 'thread' | 'internal';
  created_at: string;
}

export interface Partner {
  id: number;
  server_name: string;
  pic_discord_id: string;
  pic_username: string;
  backup_pic_discord_id: string | null;
  backup_pic_name: string | null;
  invite_link: string | null;
  invite_status: 'unknown' | 'valid' | 'invalid';
  tags: string[];
  status: 'active' | 'inactive' | 'blacklisted';
  strikes: number;
  collaboration_history: string;
  notes: string;
  joined_at: string;
  updated_at: string;
}

export interface WarningRecord {
  id: number;
  target_discord_id: string;
  target_username: string;
  target_type: 'member' | 'partner';
  partner_id: number | null;
  level: number;
  reason: string;
  evidence_url: string | null;
  issued_by: string;
  created_at: string;
}

export interface MessageTemplate {
  id: number;
  name: string;
  category: ConversationCategory;
  content: string;
  created_at: string;
}

export interface Aspiration {
  id: number;
  discord_user_id: string;
  is_anonymous: number;
  sender_label: string;
  category: string;
  content: string;
  status: 'new' | 'reviewed' | 'resolved';
  admin_notes: string;
  created_at: string;
}

export interface EventRsvp {
  id: number;
  event_id: number;
  partner_id: number;
  server_name?: string;
  pic_username?: string;
  pic_discord_id: string;
  status: 'pending' | 'attending' | 'representative' | 'declined' | 'failed';
  responded_at: string | null;
}

export interface EventInvite {
  id: number;
  title: string;
  description: string;
  event_date: string;
  created_by: string;
  created_at: string;
  rsvps?: EventRsvp[];
}

export interface Survey {
  id: number;
  title: string;
  description: string;
  is_active: number;
  created_by: string;
  created_at: string;
  response_count?: number;
  avg_rating?: number;
}

export interface SurveyResponse {
  id: number;
  survey_id: number;
  discord_user_id: string;
  discord_username: string;
  rating: number;
  feedback: string;
  created_at: string;
}

export interface OfficeHoursSettings {
  enabled: boolean;
  timezone: string;
  startHour: number;
  endHour: number;
  activeDays: number[];
  awayMessage: string;
}

export interface GuildMemberOption {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
}

export interface BotStatus {
  ready: boolean;
  tag: string | null;
  avatar: string | null;
  guildConfigured: boolean;
  tokenConfigured: boolean;
}

export type QuickContactGroup = 'staff' | 'benefit' | 'vip' | 'other';

export interface QuickContact {
  id: number;
  discord_user_id: string;
  discord_username: string;
  label: string;
  group_tag: QuickContactGroup;
  notes: string;
  created_by: string;
  created_at: string;
}

export interface GuildChannelOption {
  id: string;
  name: string;
  parentName: string | null;
  type: 'text' | 'announcement';
}

export interface ChannelPost {
  id: number;
  channel_id: string;
  channel_name: string;
  embed_title: string | null;
  content: string;
  attachments: MessageAttachment[];
  discord_message_id: string | null;
  sent_by: string;
  created_at: string;
}

export interface AuditLog {
  id: number;
  admin_username: string;
  admin_name: string;
  admin_role: string;
  action: string;
  target: string;
  details: string;
  created_at: string;
}

export interface MediaKitSettings {
  serverName: string;
  description: string;
  requirements: string;
  inviteLink: string;
  logoUrl: string;
  bannerUrl: string;
}

export interface CustomRoleSettings {
  enabled: boolean;
  anchorRoleId: string;
  defaultMaxShares: number;
  allowHoist: boolean;
}

export interface CustomRoleRecord {
  id: number;
  discord_user_id: string;
  discord_username: string;
  role_id: string | null;
  source: 'booster' | 'admin_grant';
  name: string;
  color: string;
  side_color: string | null;
  description: string;
  icon_url: string | null;
  banner_url: string | null;
  hoisted: number;
  max_shares: number;
  shared_with: string[];
  created_at: string;
  updated_at: string;
}

export interface OverviewStats {
  unreadConversations: number;
  totalConversations: number;
  followUpCount: number;
  activePartners: number;
  invalidInvites: number;
  warningsThisMonth: number;
  newAspirations: number;
  activeCustomRoles: number;
  surveyResponses: number;
  surveyAvgRating: number | null;
  followUpList: Conversation[];
}

export interface AnonSessionPublic {
  id: number;
  alias: string;
  topic: string;
  status: 'open' | 'closed';
  unread_count: number;
  last_message_at: string;
  last_message_preview: string | null;
  created_at: string;
}

export interface AnonMessage {
  id: number;
  session_id: number;
  sender_type: 'anon' | 'admin' | 'system';
  sender_label: string;
  content: string;
  attachments: MessageAttachment[];
  created_at: string;
}

export type TournamentMode = 'team' | 'solo';

export interface TournamentNotifSettings {
  announceChannelId: string;
  sendDm: boolean;
  approveMessage: string;
  rejectMessage: string;
}

export interface Tournament {
  id: number;
  title: string;
  game: string;
  mode: TournamentMode;
  max_slots: number;
  description: string;
  participant_role_id: string | null;
  channel_id: string | null;
  message_id: string | null;
  is_open: number;
  created_by: string;
  created_at: string;
  approved_count?: number;
  pending_count?: number;
}

export interface TournamentRegistration {
  id: number;
  tournament_id: number;
  captain_discord_id: string;
  captain_username: string;
  team_name: string;
  representative_contact: string;
  roster_text: string;
  substitutes: string;
  notes: string;
  status: 'pending' | 'approved' | 'rejected';
  reject_reason: string;
  reviewed_by: string | null;
  created_at: string;
}
