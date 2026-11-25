import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Interaction,
  type Message,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';
import { config } from './config.js';
import {
  addAnonMessage,
  addMessage,
  closeAnonSession,
  createAnonSession,
  createAspiration,
  findPartnersByPicId,
  getActiveAnonSessionByUserId,
  getActiveSurvey,
  getAnonSessionInternalById,
  getConversationById,
  getConversationByThreadId,
  getOfficeHours,
  isOutsideOfficeHours,
  recordBroadcastReceipt,
  submitSurveyResponse,
  toPublicAnonSession,
  updateConversationMeta,
  upsertConversation,
  upsertEventRsvp,
} from './db.js';
import {
  emitAnonMessage,
  emitAnonSessionUpdated,
  emitConversationUpdated,
  emitNewMessage,
  emitNotification,
} from './realtime.js';
import {
  buildCustomRoleInfoPayload,
  handleBoosterStatusChange,
  handleCustomRoleInteraction,
  handleCustomRolePrefixCommand,
} from './customRole.js';
import {
  compressImageBuffer,
  downloadImageBuffer,
  formatBytes,
  removeBackgroundBuffer,
} from './imageTools.js';
import {
  handleTournamentInteraction,
  handleTournamentNotifCommand,
} from './tournaments.js';
import type { Conversation, MessageAttachment } from './types.js';

export const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User],
});

let botReady = false;
// Throttle away auto-reply per user (max once per 6 hours)
const lastAwayReplyAt = new Map<string, number>();

export function isBotReady(): boolean {
  return botReady && discordClient.isReady();
}

export function getBotStatus() {
  return {
    ready: isBotReady(),
    tag: discordClient.user?.tag || null,
    avatar: discordClient.user?.displayAvatarURL() || null,
    guildConfigured: Boolean(config.guildId),
    tokenConfigured: Boolean(config.discordToken),
  };
}

// Download incoming Discord attachments locally so they never expire after 24h
async function downloadDiscordAttachments(message: Message): Promise<MessageAttachment[]> {
  const saved: MessageAttachment[] = [];
  for (const att of message.attachments.values()) {
    try {
      const res = await fetch(att.url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = path.extname(att.name || '') || '.bin';
      const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
      const fullPath = path.join(config.uploadsDir, filename);
      fs.writeFileSync(fullPath, buf);
      saved.push({
        filename,
        originalName: att.name || filename,
        mimeType: att.contentType || 'application/octet-stream',
        size: buf.length,
        url: `/api/uploads/${filename}`,
      });
    } catch (err) {
      console.error('[Bot] Gagal download attachment:', err);
    }
  }
  return saved;
}

export async function sendInternalNotif(title: string, description: string, url?: string): Promise<void> {
  if (!isBotReady() || !config.notifChannelId) return;
  try {
    const ch = await discordClient.channels.fetch(config.notifChannelId);
    if (!ch || !ch.isTextBased() || !('send' in ch)) return;
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description + (url ? `\n\n🔗 [Buka di Web Humas](${url})` : ''))
      .setColor(0x6366f1)
      .setTimestamp();
    await ch.send({ embeds: [embed] });
  } catch (err) {
    console.error('[Bot] Gagal kirim notif ke channel internal:', err);
  }
}

export async function sendMessageToDiscord(params: {
  conversation: Conversation;
  content: string;
  attachments?: MessageAttachment[];
  components?: ActionRowBuilder<ButtonBuilder>[];
  embed?: EmbedBuilder;
}): Promise<{ discordMessageId: string; deliveryChannel: 'dm' | 'thread' }> {
  if (!isBotReady()) {
    throw new Error('Bot Discord belum terhubung. Cek DISCORD_TOKEN di .env.');
  }

  const files = (params.attachments || []).map((att) =>
    new AttachmentBuilder(path.join(config.uploadsDir, att.filename), {
      name: att.originalName,
    })
  );

  const payload = {
    content: params.content || undefined,
    embeds: params.embed ? [params.embed] : undefined,
    files: files.length > 0 ? files : undefined,
    components: params.components && params.components.length > 0 ? params.components : undefined,
  };

  // If a fallback Private Thread already exists and DM was marked blocked, use thread directly
  if (params.conversation.dm_blocked && params.conversation.fallback_thread_id) {
    const thread = await discordClient.channels.fetch(params.conversation.fallback_thread_id);
    if (thread && thread.isThread()) {
      const sent = await thread.send(payload);
      return { discordMessageId: sent.id, deliveryChannel: 'thread' };
    }
  }

  try {
    const user = await discordClient.users.fetch(params.conversation.discord_user_id);
    const sent = await user.send(payload);
    if (params.conversation.dm_blocked) {
      updateConversationMeta(params.conversation.id, { dm_blocked: 0 });
    }
    return { discordMessageId: sent.id, deliveryChannel: 'dm' };
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 50007) {
      // Cannot send messages to this user (DMs disabled)
      const updated = updateConversationMeta(params.conversation.id, { dm_blocked: 1 });
      if (updated) emitConversationUpdated(updated);
      const dmErr = new Error('DM_BLOCKED');
      throw dmErr;
    }
    throw err;
  }
}

export async function createFallbackPrivateThread(
  conversation: Conversation,
  initialMessage?: string
): Promise<{ threadId: string; messageId?: string }> {
  if (!isBotReady()) {
    throw new Error('Bot Discord belum terhubung.');
  }
  if (!config.fallbackChannelId) {
    throw new Error('FALLBACK_CHANNEL_ID belum diatur di .env.');
  }

  const channel = await discordClient.channels.fetch(config.fallbackChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error('FALLBACK_CHANNEL_ID harus berupa Text Channel di server.');
  }

  const textChannel = channel as TextChannel;
  const threadName = `humas-${conversation.discord_username.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20)}-${conversation.id}`;
  const thread: ThreadChannel = await textChannel.threads.create({
    name: threadName,
    type: ChannelType.PrivateThread,
    invitable: false,
    reason: `Fallback komunikasi resmi Humas untuk ${conversation.discord_username}`,
  });

  await thread.members.add(conversation.discord_user_id).catch(() => {});

  const intro =
    initialMessage ||
    `Halo <@${conversation.discord_user_id}>! Karena DM kamu tertutup, Tim Humas membuka saluran privat resmi ini untuk berkomunikasi denganmu. Kamu bisa membalas langsung di sini.`;

  const sent = await thread.send(intro);
  const updated = updateConversationMeta(conversation.id, {
    fallback_thread_id: thread.id,
    dm_blocked: 1,
  });
  if (updated) emitConversationUpdated(updated);

  return { threadId: thread.id, messageId: sent.id };
}

export async function searchGuildMembers(query: string) {
  if (!isBotReady() || !config.guildId) return [];
  try {
    const guild = await discordClient.guilds.fetch(config.guildId);
    const trimmed = query.trim();
    if (!trimmed) {
      const members = await guild.members.list({ limit: 25 });
      return members
        .filter((m) => !m.user.bot)
        .map((m) => ({
          id: m.user.id,
          username: m.user.username,
          displayName: m.displayName,
          avatar: m.user.displayAvatarURL({ size: 64 }),
        }));
    }
    const members = await guild.members.search({ query: trimmed, limit: 25 });
    return members
      .filter((m) => !m.user.bot)
      .map((m) => ({
        id: m.user.id,
        username: m.user.username,
        displayName: m.displayName,
        avatar: m.user.displayAvatarURL({ size: 64 }),
      }));
  } catch (err) {
    console.error('[Bot] Gagal cari member guild:', err);
    return [];
  }
}

export async function sendAnonReplyToDiscord(params: {
  sessionId: number;
  content: string;
  attachments?: MessageAttachment[];
}): Promise<void> {
  if (!isBotReady()) {
    throw new Error('Bot Discord belum terhubung.');
  }
  const session = getAnonSessionInternalById(params.sessionId);
  if (!session) throw new Error('Sesi anonim tidak ditemukan.');

  const files = (params.attachments || []).map((att) =>
    new AttachmentBuilder(path.join(config.uploadsDir, att.filename), {
      name: att.originalName,
    })
  );

  const user = await discordClient.users.fetch(session.discord_user_id);
  await user.send({
    content: params.content ? `**🎭 Balasan Admin (${session.alias}):**\n${params.content}` : undefined,
    files: files.length > 0 ? files : undefined,
  });
}

export async function notifyAnonSessionClosed(sessionId: number): Promise<void> {
  if (!isBotReady()) return;
  const session = getAnonSessionInternalById(sessionId);
  if (!session) return;
  try {
    const user = await discordClient.users.fetch(session.discord_user_id);
    await user.send(
      `🔒 Sesi chat anonim **${session.alias}** telah ditutup oleh Tim Humas. Terima kasih sudah bercerita! Kamu bisa membuka sesi baru kapan saja lewat \`/anonchat\`.`
    );
  } catch {
    // Ignore if DMs are closed
  }
}

export async function checkDiscordInvite(inviteLink: string): Promise<'valid' | 'invalid'> {
  if (!isBotReady()) return 'invalid';
  try {
    await discordClient.fetchInvite(inviteLink);
    return 'valid';
  } catch {
    return 'invalid';
  }
}

export async function listGuildTextChannels(): Promise<
  Array<{ id: string; name: string; parentName: string | null; type: 'text' | 'announcement' }>
> {
  if (!isBotReady() || !config.guildId) return [];
  try {
    const guild = await discordClient.guilds.fetch(config.guildId);
    const channels = await guild.channels.fetch();
    const list: Array<{
      id: string;
      name: string;
      parentName: string | null;
      type: 'text' | 'announcement';
      position: number;
    }> = [];

    for (const ch of channels.values()) {
      if (!ch) continue;
      if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement) {
        list.push({
          id: ch.id,
          name: ch.name,
          parentName: ch.parent?.name || null,
          type: ch.type === ChannelType.GuildAnnouncement ? 'announcement' : 'text',
          position: ch.rawPosition,
        });
      }
    }

    return list
      .sort((a, b) => a.position - b.position)
      .map(({ id, name, parentName, type }) => ({ id, name, parentName, type }));
  } catch (err) {
    console.error('[Bot] Gagal mengambil daftar channel server:', err);
    return [];
  }
}

export async function sendMessageToChannel(params: {
  channelId: string;
  content: string;
  useEmbed?: boolean;
  embedTitle?: string;
  embedColor?: string;
  attachments?: MessageAttachment[];
}): Promise<{ discordMessageId: string; channelName: string }> {
  if (!isBotReady()) {
    throw new Error('Bot Discord belum terhubung. Cek DISCORD_TOKEN di .env.');
  }

  const ch = await discordClient.channels.fetch(params.channelId);
  if (
    !ch ||
    (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.GuildAnnouncement) ||
    !('send' in ch)
  ) {
    throw new Error('Channel tidak ditemukan atau bukan Text/Announcement Channel.');
  }

  const files = (params.attachments || []).map((att) =>
    new AttachmentBuilder(path.join(config.uploadsDir, att.filename), {
      name: att.originalName,
    })
  );

  if (params.useEmbed) {
    const colorNum = params.embedColor
      ? Number.parseInt(params.embedColor.replace('#', ''), 16) || 0x6366f1
      : 0x6366f1;
    const embed = new EmbedBuilder()
      .setColor(colorNum)
      .setDescription(params.content || '\u200B')
      .setFooter({ text: 'Informasi Resmi • Tim Humas' })
      .setTimestamp();
    if (params.embedTitle?.trim()) {
      embed.setTitle(params.embedTitle.trim());
    }
    const sent = await ch.send({
      embeds: [embed],
      files: files.length > 0 ? files : undefined,
    });
    return { discordMessageId: sent.id, channelName: ch.name };
  }

  const sent = await ch.send({
    content: params.content || undefined,
    files: files.length > 0 ? files : undefined,
  });
  return { discordMessageId: sent.id, channelName: ch.name };
}

// Register slash commands (/aspirasi and /survei)
async function registerSlashCommands(): Promise<void> {
  if (!config.discordToken || !discordClient.user) return;
  const commands = [
    new SlashCommandBuilder()
      .setName('aspirasi')
      .setDescription('Kirim saran, kritik, atau aduan ke Tim Humas (bisa anonim)')
      .addStringOption((opt) =>
        opt
          .setName('kategori')
          .setDescription('Kategori aspirasi')
          .setRequired(true)
          .addChoices(
            { name: 'Saran / Ide', value: 'Saran' },
            { name: 'Kritik / Masukan', value: 'Kritik' },
            { name: 'Aduan / Laporan', value: 'Aduan' },
            { name: 'Pertanyaan', value: 'Pertanyaan' }
          )
      )
      .addStringOption((opt) =>
        opt.setName('isi').setDescription('Isi pesan aspirasimu').setRequired(true)
      )
      .addBooleanOption((opt) =>
        opt
          .setName('anonim')
          .setDescription('Sembunyikan identitasmu? (Default: Ya)')
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('survei')
      .setDescription('Isi survei evaluasi event aktif dari Tim Humas'),
    new SlashCommandBuilder()
      .setName('mrole')
      .setDescription('Buka panel kustomisasi Custom Role (khusus Server Booster & Benefit Humas)')
      .addUserOption((opt) =>
        opt.setName('user').setDescription('Lihat Custom Role milik member lain').setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('anonchat')
      .setDescription('Mulai chat anonim 2 arah dengan Admin (curhat/aduan, identitas 100% dirahasiakan)'),
    new SlashCommandBuilder()
      .setName('removebg')
      .setDescription('Hapus background gambar & kompres otomatis ≤ 256 KB PNG (siap untuk Role Icon)')
      .addAttachmentOption((opt) =>
        opt.setName('gambar').setDescription('Upload gambar yang ingin dihapus background-nya').setRequired(true)
      )
      .addIntegerOption((opt) =>
        opt
          .setName('toleransi')
          .setDescription('Sensitivitas hapus background lokal (10–90, default: 42)')
          .setMinValue(10)
          .setMaxValue(90)
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('compress')
      .setDescription('Kompres & ubah format gambar ke PNG/JPG ≤ 256 KB (siap untuk Role Icon Discord)')
      .addAttachmentOption((opt) =>
        opt.setName('gambar').setDescription('Upload gambar yang ingin dikompres').setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName('format')
          .setDescription('Format hasil (default: PNG)')
          .setRequired(false)
          .addChoices(
            { name: 'PNG (Transparan)', value: 'png' },
            { name: 'JPG (Ukuran Lebih Kecil)', value: 'jpeg' }
          )
      )
      .addIntegerOption((opt) =>
        opt
          .setName('max_kb')
          .setDescription('Target batas ukuran maksimal dalam KB (default: 256 KB)')
          .setMinValue(32)
          .setMaxValue(1024)
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('turnamen-notif')
      .setDescription('Atur notifikasi Approve/Reject pendaftaran turnamen (Khusus Admin)')
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Channel tujuan pengumuman tim/peserta yang di-Approve')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false)
      )
      .addBooleanOption((opt) =>
        opt
          .setName('kirim_dm')
          .setDescription('Kirim DM konfirmasi otomatis ke perwakilan/kapten?')
          .setRequired(false)
      )
      .addStringOption((opt) =>
        opt
          .setName('pesan_approve')
          .setDescription('Template pesan Approve (pakai {tim}, {turnamen}, {kapten})')
          .setRequired(false)
      )
      .addStringOption((opt) =>
        opt
          .setName('pesan_reject')
          .setDescription('Template pesan Reject (pakai {tim}, {turnamen}, {alasan})')
          .setRequired(false)
      )
      .addBooleanOption((opt) =>
        opt
          .setName('matikan_channel')
          .setDescription('Matikan notifikasi ke channel (hanya DM saja)')
          .setRequired(false)
      ),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  try {
    if (config.guildId) {
      await rest.put(Routes.applicationGuildCommands(discordClient.user.id, config.guildId), {
        body: commands,
      });
      console.log('[Bot] Slash commands (/aspirasi, /survei) terdaftar di guild.');
    } else {
      await rest.put(Routes.applicationCommands(discordClient.user.id), { body: commands });
      console.log('[Bot] Slash commands (/aspirasi, /survei) terdaftar secara global.');
    }
  } catch (err) {
    console.error('[Bot] Gagal mendaftarkan slash commands:', err);
  }
}

// Handle incoming DMs, fallback Private Thread messages, and !mrole prefix shortcuts
discordClient.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // Handle guild prefix shortcuts (!mrole, !mcolor, !micon, !mname, !mshare, !munshare)
  if (message.guild && message.content.startsWith('!')) {
    const handled = await handleCustomRolePrefixCommand(message).catch((err) => {
      console.error('[Bot] Error prefix mrole:', err);
      return false;
    });
    if (handled) return;
  }

  const isDM = message.channel.type === ChannelType.DM;
  const isFallbackThread =
    message.channel.isThread() && Boolean(getConversationByThreadId(message.channel.id));

  if (!isDM && !isFallbackThread) return;

  // If this DM belongs to an active 2-way Anonymous Chat session, route strictly to anon_messages!
  if (isDM) {
    const activeAnon = getActiveAnonSessionByUserId(message.author.id);
    if (activeAnon) {
      const trimmed = message.content.trim().toLowerCase();
      if (trimmed === '!tutup' || trimmed === '!close') {
        const closed = closeAnonSession(activeAnon.id);
        const sysMsg = addAnonMessage({
          sessionId: activeAnon.id,
          senderType: 'system',
          senderLabel: 'Sistem',
          content: `${activeAnon.alias} menutup sesi anonim.`,
        });
        if (closed) {
          emitAnonMessage(closed, sysMsg);
          emitAnonSessionUpdated(closed);
        }
        await message.reply(
          `✅ Sesi chat anonim **${activeAnon.alias}** telah ditutup. Terima kasih sudah bercerita!`
        );
        return;
      }

      const attachments = await downloadDiscordAttachments(message);
      const saved = addAnonMessage({
        sessionId: activeAnon.id,
        senderType: 'anon',
        senderLabel: activeAnon.alias,
        content: message.content || '',
        attachments,
      });
      const updatedSession = toPublicAnonSession(getAnonSessionInternalById(activeAnon.id) || activeAnon);
      emitAnonMessage(updatedSession, saved);
      emitNotification({
        type: 'anon',
        title: `🎭 Pesan Anonim (${updatedSession.alias})`,
        body: saved.content || `[${attachments.length} Lampiran]`,
      });
      await sendInternalNotif(
        `🎭 Pesan Anonim Baru — ${updatedSession.alias}`,
        `**Topik:** ${updatedSession.topic}\n**Pesan:** ${saved.content || '(Lampiran)'}\n\n*(Identitas pengirim dirahasiakan)*`,
        config.webBaseUrl
      );
      return;
    }
  }

  let conversation: Conversation | undefined;
  if (isFallbackThread) {
    conversation = getConversationByThreadId(message.channel.id);
  } else {
    conversation = upsertConversation({
      discordUserId: message.author.id,
      discordUsername: message.author.username,
      discordAvatar: message.author.displayAvatarURL({ size: 64 }),
    });
  }

  if (!conversation) return;

  const attachments = await downloadDiscordAttachments(message);
  const savedMsg = addMessage({
    conversationId: conversation.id,
    senderType: 'user',
    senderName: message.author.username,
    content: message.content || '',
    attachments,
    discordMessageId: message.id,
    deliveryChannel: isFallbackThread ? 'thread' : 'dm',
  });

  const updatedConv = getConversationById(conversation.id) || conversation;
  emitNewMessage(updatedConv, savedMsg);
  emitNotification({
    type: 'dm',
    title: `Pesan baru dari ${message.author.username}`,
    body: savedMsg.content || `[${attachments.length} Lampiran]`,
    conversationId: updatedConv.id,
  });

  await sendInternalNotif(
    `📩 Pesan Baru (${updatedConv.type === 'partner' ? 'Partner' : 'Member'})`,
    `**Dari:** ${message.author.username} (<@${message.author.id}>)\n**Pesan:** ${savedMsg.content || '(Lampiran gambar/file)'}`,
    `${config.webBaseUrl}/?conv=${updatedConv.id}`
  );

  // Office Hours Auto-Reply
  const officeHours = getOfficeHours();
  if (isOutsideOfficeHours(officeHours)) {
    const lastSent = lastAwayReplyAt.get(message.author.id) || 0;
    const sixHours = 6 * 60 * 60 * 1000;
    if (Date.now() - lastSent > sixHours) {
      lastAwayReplyAt.set(message.author.id, Date.now());
      try {
        await message.reply(officeHours.awayMessage);
        const sysMsg = addMessage({
          conversationId: updatedConv.id,
          senderType: 'system',
          senderName: 'Auto-Reply (Jam Operasional)',
          content: officeHours.awayMessage,
          deliveryChannel: isFallbackThread ? 'thread' : 'dm',
        });
        emitNewMessage(getConversationById(updatedConv.id) || updatedConv, sysMsg);
      } catch (err) {
        console.error('[Bot] Gagal kirim auto-reply office hours:', err);
      }
    }
  }
});

// Alert Humas if a registered Partner PIC leaves the guild
discordClient.on(Events.GuildMemberRemove, async (member) => {
  const partners = findPartnersByPicId(member.id);
  if (partners.length === 0) return;

  const names = partners.map((p) => `**${p.server_name}**`).join(', ');
  const desc = `⚠️ PIC **${member.user.username}** (<@${member.id}>) baru saja keluar dari server!\nPartner terkait: ${names}\nSegera hubungi PIC cadangan atau evaluasi status partnership.`;

  emitNotification({
    type: 'partner_leave',
    title: 'PIC Partner Keluar Server!',
    body: `${member.user.username} (${partners.map((p) => p.server_name).join(', ')})`,
  });

  await sendInternalNotif('⚠️ Alert: PIC Partner Keluar Server', desc, config.webBaseUrl);
});

// Auto-cleanup Booster Custom Role when a member stops boosting
discordClient.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (oldMember.partial || newMember.partial) return;
  await handleBoosterStatusChange(oldMember, newMember).catch((err) => {
    console.error('[Bot] Error cek status booster:', err);
  });
});

// Slash commands & interactive buttons (RSVP, Read Receipt, Survey, Custom Role)
discordClient.on(Events.InteractionCreate, async (interaction: Interaction) => {
  try {
    // 0. Humas Custom Role interactions (hcr_*)
    if (await handleCustomRoleInteraction(interaction)) {
      return;
    }

    // 0b. Tournament Registration interactions (trn_*)
    if (await handleTournamentInteraction(interaction, sendInternalNotif)) {
      return;
    }

    // 1. Slash Commands
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'turnamen-notif') {
        await handleTournamentNotifCommand(interaction);
        return;
      }

      if (interaction.commandName === 'removebg') {
        await interaction.deferReply();
        const att = interaction.options.getAttachment('gambar', true);
        const tolerance = interaction.options.getInteger('toleransi') ?? 42;
        try {
          const rawBuf = await downloadImageBuffer(att.url, 10);
          const result = await removeBackgroundBuffer(rawBuf, {
            maxBytes: 256 * 1024,
            maxDimension: 512,
            tolerance,
          });
          const file = new AttachmentBuilder(result.buffer, { name: 'nobg-icon.png' });
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(0x10b981)
                .setTitle('✂️ Background Berhasil Dihapus!')
                .setDescription(
                  `📦 **Ukuran:** ${formatBytes(result.originalBytes)} → **${formatBytes(result.finalBytes)}** (${result.width}×${result.height}px PNG)\n🛠️ **Metode:** ${result.method === 'remove.bg' ? 'AI Remove.bg' : `Lokal (toleransi: ${tolerance})`}\n\n💡 Siap langsung dipakai sebagai Role Icon Discord (≤ 256 KB)!`
                ),
            ],
            files: [file],
          });
        } catch (err: unknown) {
          await interaction.editReply(
            `❌ Gagal menghapus background: ${err instanceof Error ? err.message : 'Error tidak diketahui'}`
          );
        }
        return;
      }

      if (interaction.commandName === 'compress') {
        await interaction.deferReply();
        const att = interaction.options.getAttachment('gambar', true);
        const format = (interaction.options.getString('format') as 'png' | 'jpeg' | null) || 'png';
        const maxKb = interaction.options.getInteger('max_kb') ?? 256;
        try {
          const rawBuf = await downloadImageBuffer(att.url, 10);
          const result = await compressImageBuffer(rawBuf, {
            maxBytes: maxKb * 1024,
            maxDimension: 512,
            preferFormat: format,
          });
          const ext = result.format === 'jpeg' ? 'jpg' : 'png';
          const file = new AttachmentBuilder(result.buffer, { name: `compressed.${ext}` });
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(0x6366f1)
                .setTitle('📦 Gambar Berhasil Dikompres!')
                .setDescription(
                  `📉 **Ukuran:** ${formatBytes(result.originalBytes)} → **${formatBytes(result.finalBytes)}** (target ≤ ${maxKb} KB)\n🖼️ **Format & Dimensi:** ${result.format.toUpperCase()} • ${result.width}×${result.height}px\n\n💡 Sudah memenuhi syarat Discord Role Icon (≤ 256 KB, JPG/PNG)!`
                ),
            ],
            files: [file],
          });
        } catch (err: unknown) {
          await interaction.editReply(
            `❌ Gagal mengompres gambar: ${err instanceof Error ? err.message : 'Error tidak diketahui'}`
          );
        }
        return;
      }

      if (interaction.commandName === 'anonchat') {
        const existing = getActiveAnonSessionByUserId(interaction.user.id);
        if (existing) {
          await interaction.reply({
            content: `🎭 Kamu sudah memiliki sesi chat anonim aktif (**${existing.alias}**). Langsung balas di **DM Bot** untuk melanjutkan, atau ketik \`!tutup\` di DM Bot untuk mengakhiri sesi.`,
            ephemeral: true,
          });
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId('anonchat_start_modal')
          .setTitle('🎭 Mulai Chat Anonim ke Admin');

        const topicInput = new TextInputBuilder()
          .setCustomId('topic')
          .setLabel('Topik (Curhat / Aduan / Masalah / Lainnya)')
          .setPlaceholder('Contoh: Curhat / Aduan member / Saran pribadi')
          .setMaxLength(60)
          .setRequired(true)
          .setStyle(TextInputStyle.Short);

        const msgInput = new TextInputBuilder()
          .setCustomId('message')
          .setLabel('Ceritakan pesanmu (Identitasmu 100% rahasia)')
          .setPlaceholder('Tulis di sini... Admin hanya akan melihat alias anonim.')
          .setMaxLength(1500)
          .setRequired(true)
          .setStyle(TextInputStyle.Paragraph);

        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(topicInput),
          new ActionRowBuilder<TextInputBuilder>().addComponents(msgInput)
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.commandName === 'mrole') {
        if (!interaction.guild) {
          await interaction.reply({
            content: '❌ Command `/mrole` hanya bisa digunakan di dalam server.',
            ephemeral: true,
          });
          return;
        }
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const payload = await buildCustomRoleInfoPayload(interaction.guild, targetUser.id, 'view');
        await interaction.reply(payload);
        return;
      }

      if (interaction.commandName === 'aspirasi') {
        const kategori = interaction.options.getString('kategori', true);
        const isi = interaction.options.getString('isi', true);
        const anonim = interaction.options.getBoolean('anonim') ?? true;

        const saved = createAspiration({
          discord_user_id: interaction.user.id,
          is_anonymous: anonim,
          sender_label: anonim ? 'Anonim' : interaction.user.username,
          category: kategori,
          content: isi,
        });

        await interaction.reply({
          content: `✅ Terima kasih! Aspirasi kategori **${kategori}** kamu sudah diterima oleh Tim Humas${anonim ? ' secara **anonim**' : ''}.`,
          ephemeral: true,
        });

        emitNotification({
          type: 'aspiration',
          title: `Aspirasi Baru (${kategori})`,
          body: `${saved.sender_label}: ${isi.slice(0, 80)}`,
        });

        await sendInternalNotif(
          `💡 Aspirasi Baru (${kategori})`,
          `**Pengirim:** ${saved.sender_label}\n**Isi:** ${isi}`,
          config.webBaseUrl
        );
        return;
      }

      if (interaction.commandName === 'survei') {
        const survey = getActiveSurvey();
        if (!survey) {
          await interaction.reply({
            content: 'Saat ini belum ada survei evaluasi event yang aktif.',
            ephemeral: true,
          });
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId(`survey_modal:${survey.id}`)
          .setTitle(survey.title.slice(0, 45));

        const ratingInput = new TextInputBuilder()
          .setCustomId('rating')
          .setLabel('Rating Event (angka 1 sampai 5)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('Contoh: 5');

        const feedbackInput = new TextInputBuilder()
          .setCustomId('feedback')
          .setLabel('Kesan, Pesan, atau Masukan')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setPlaceholder('Tulis masukan kamu di sini...');

        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(ratingInput),
          new ActionRowBuilder<TextInputBuilder>().addComponents(feedbackInput)
        );

        await interaction.showModal(modal);
        return;
      }
    }

    // 2. Modal Submissions (Anon Chat & Survey)
    if (interaction.isModalSubmit() && interaction.customId === 'anonchat_start_modal') {
      const topic = interaction.fields.getTextInputValue('topic').trim() || 'Curhat / Aduan';
      const content = interaction.fields.getTextInputValue('message').trim();

      const session = createAnonSession(interaction.user.id, topic);
      const saved = addAnonMessage({
        sessionId: session.id,
        senderType: 'anon',
        senderLabel: session.alias,
        content,
      });

      const pub = toPublicAnonSession(getAnonSessionInternalById(session.id) || session);
      emitAnonMessage(pub, saved);
      emitNotification({
        type: 'anon',
        title: `🎭 Sesi Anonim Baru (${pub.alias})`,
        body: `[${pub.topic}] ${content.slice(0, 80)}`,
      });

      await sendInternalNotif(
        `🎭 Sesi Chat Anonim Baru — ${pub.alias}`,
        `**Topik:** ${pub.topic}\n**Pesan:** ${content.slice(0, 300)}\n\n*(Identitas pengirim 100% dirahasiakan)*`,
        config.webBaseUrl
      );

      let dmNote = 'Cek **DM dari Bot** untuk melanjutkan obrolan 2 arah secara anonim (ketik `!tutup` kapan saja untuk mengakhiri).';
      try {
        await interaction.user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle(`🎭 Sesi Chat Anonim Aktif — ${pub.alias}`)
              .setColor(0x8b5cf6)
              .setDescription(
                `Pesanmu sudah diterima oleh Admin secara **100% anonim** (Admin hanya melihat alias **${pub.alias}**).\n\nKamu bisa langsung **membalas di DM ini** untuk melanjutkan obrolan 2 arah. Ketik \`!tutup\` kapan saja untuk mengakhiri sesi.`
              )
              .setTimestamp(),
          ],
        });
      } catch {
        dmNote = '⚠️ **DM kamu tertutup!** Aktifkan *"Allow direct messages from server members"* agar bisa menerima balasan admin di DM.';
      }

      await interaction.reply({
        content: `✅ Sesi chat anonim **${pub.alias}** berhasil dibuka!\n${dmNote}`,
        ephemeral: true,
      });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('survey_modal:')) {
      const surveyId = Number(interaction.customId.split(':')[1]);
      const rawRating = Number(interaction.fields.getTextInputValue('rating'));
      const rating = Math.min(5, Math.max(1, Number.isFinite(rawRating) ? Math.round(rawRating) : 5));
      const feedback = interaction.fields.getTextInputValue('feedback') || '';

      submitSurveyResponse({
        survey_id: surveyId,
        discord_user_id: interaction.user.id,
        discord_username: interaction.user.username,
        rating,
        feedback,
      });

      await interaction.reply({
        content: `🙏 Terima kasih atas penilaianmu (**${rating}/5**)! Masukanmu sangat berarti bagi Tim Humas.`,
        ephemeral: true,
      });

      emitNotification({
        type: 'survey',
        title: 'Respons Survei Baru',
        body: `${interaction.user.username} memberi rating ${rating}/5`,
      });
      return;
    }

    // 3. Buttons (Partner RSVP & Broadcast Read Receipt)
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('rsvp:')) {
        const [, eventIdStr, partnerIdStr, status] = interaction.customId.split(':');
        const eventId = Number(eventIdStr);
        const partnerId = Number(partnerIdStr);
        const validStatus =
          status === 'attending' || status === 'representative' || status === 'declined'
            ? status
            : 'attending';

        upsertEventRsvp(eventId, partnerId, interaction.user.id, validStatus);

        const labelMap = {
          attending: '✅ Konfirmasi **Hadir**',
          representative: '👥 Konfirmasi **Kirim Perwakilan**',
          declined: '❌ Konfirmasi **Tidak Dapat Hadir**',
        };

        await interaction.reply({
          content: `Terima kasih! Status RSVP kamu tercatat: ${labelMap[validStatus]}.`,
          ephemeral: true,
        });

        emitNotification({
          type: 'rsvp',
          title: 'Update RSVP Event Partner',
          body: `${interaction.user.username} memilih: ${validStatus}`,
        });
        return;
      }

      if (interaction.customId.startsWith('receipt:')) {
        const [, broadcastId, partnerIdStr, action] = interaction.customId.split(':');
        const partnerId = Number(partnerIdStr);
        const status = action === 'declined' ? 'declined' : 'confirmed';

        recordBroadcastReceipt(broadcastId, partnerId, interaction.user.id, status);

        await interaction.reply({
          content:
            status === 'confirmed'
              ? '✅ Terima kasih! Konfirmasi penerimaan & dukungan share sudah tercatat di Tim Humas.'
              : '👌 Terima kasih atas konfirmasinya. Tidak masalah jika sedang berhalangan kali ini!',
          ephemeral: true,
        });

        emitNotification({
          type: 'broadcast',
          title: 'Konfirmasi Broadcast Partner',
          body: `${interaction.user.username}: ${status === 'confirmed' ? 'Siap Share' : 'Berhalangan'}`,
        });
      }
    }
  } catch (err) {
    console.error('[Bot] Error menangani interaction:', err);
  }
});

discordClient.once(Events.ClientReady, async (client) => {
  botReady = true;
  console.log(`[Bot] Login sebagai ${client.user.tag}`);
  await registerSlashCommands();
});

export async function startDiscordBot(): Promise<void> {
  if (!config.discordToken || config.discordToken === 'your_discord_bot_token_here') {
    console.warn(
      '[Bot] DISCORD_TOKEN belum diisi di .env. Web Control Panel tetap berjalan dalam mode offline-bot.'
    );
    return;
  }
  try {
    await discordClient.login(config.discordToken);
  } catch (err) {
    console.error('[Bot] Gagal login ke Discord:', err);
  }
}
