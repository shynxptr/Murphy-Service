import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
} from 'discord.js';
import { config } from './config.js';
import {
  createTournamentRegistration,
  findExistingRegistration,
  getTournamentById,
  getTournamentNotifSettings,
  listTournamentRegistrations,
  listTournaments,
  saveTournamentNotifSettings,
  updateTournamentPanelMessage,
} from './db.js';
import { emitNotification } from './realtime.js';
import type { Tournament, TournamentRegistration } from './types.js';

export function buildTournamentPanelPayload(trn: Tournament) {
  const approved = trn.approved_count || 0;
  const pending = trn.pending_count || 0;
  const isFull = approved >= trn.max_slots;
  const canRegister = trn.is_open === 1 && !isFull;

  const statusText =
    trn.is_open === 0
      ? '🔒 **Pendaftaran Ditutup**'
      : isFull
      ? '⚠️ **Slot Penuh**'
      : '🟢 **Pendaftaran Dibuka**';

  const embed = new EmbedBuilder()
    .setTitle(`🏆 Pendaftaran Turnamen: ${trn.title}`)
    .setColor(canRegister ? 0x10b981 : 0x64748b)
    .setDescription(
      [
        trn.description || 'Daftarkan tim atau dirimu sekarang melalui tombol di bawah ini!',
        '',
        `> 🎮 **Game:** ${trn.game}`,
        `> 👥 **Mode:** ${trn.mode === 'team' ? 'Tim / Squad' : 'Solo / Individu'}`,
        `> 📊 **Slot Terisi:** **${approved} / ${trn.max_slots}** *(Menunggu verifikasi: ${pending})*`,
        `> 📌 **Status:** ${statusText}`,
      ].join('\n')
    )
    .setFooter({ text: 'Klik tombol di bawah untuk mendaftar • Tim Humas' })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`trn_register_${trn.id}`)
      .setLabel(
        trn.is_open === 0 ? 'Pendaftaran Ditutup' : isFull ? 'Slot Penuh' : 'Daftar Sekarang'
      )
      .setEmoji('📝')
      .setStyle(canRegister ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!canRegister),
    new ButtonBuilder()
      .setCustomId(`trn_list_${trn.id}`)
      .setLabel(`Lihat Peserta (${approved}/${trn.max_slots})`)
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

export async function postTournamentPanelToChannel(
  client: Client,
  tournamentId: number,
  channelId: string
): Promise<{ messageId: string }> {
  const trn = getTournamentById(tournamentId);
  if (!trn) throw new Error('Turnamen tidak ditemukan.');

  const ch = await client.channels.fetch(channelId);
  if (
    !ch ||
    (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.GuildAnnouncement) ||
    !('send' in ch)
  ) {
    throw new Error('Channel tujuan harus berupa Text/Announcement Channel.');
  }

  const sent = await ch.send(buildTournamentPanelPayload(trn));
  updateTournamentPanelMessage(trn.id, channelId, sent.id);
  return { messageId: sent.id };
}

export async function refreshTournamentPanelMessage(
  client: Client,
  tournamentId: number
): Promise<void> {
  const trn = getTournamentById(tournamentId);
  if (!trn?.channel_id || !trn.message_id) return;
  try {
    const ch = await client.channels.fetch(trn.channel_id);
    if (!ch || !ch.isTextBased() || !('messages' in ch)) return;
    const msg = await ch.messages.fetch(trn.message_id);
    await msg.edit(buildTournamentPanelPayload(trn));
  } catch {
    // Ignore if original panel message was deleted
  }
}

function formatNotifTemplate(
  tpl: string,
  vars: { tim: string; turnamen: string; kapten: string; alasan?: string }
): string {
  return tpl
    .replace(/\{tim\}/gi, vars.tim)
    .replace(/\{turnamen\}/gi, vars.turnamen)
    .replace(/\{kapten\}/gi, vars.kapten)
    .replace(/\{alasan\}/gi, vars.alasan || '-');
}

export async function handleRegistrationDecisionEffects(
  client: Client,
  trn: Tournament,
  reg: TournamentRegistration,
  decision: 'approved' | 'rejected'
): Promise<{ dmSent: boolean; channelNotified: boolean; roleAssigned: boolean }> {
  const notifCfg = getTournamentNotifSettings();
  let dmSent = false;
  let channelNotified = false;
  let roleAssigned = false;

  const formattedMsg = formatNotifTemplate(
    decision === 'approved' ? notifCfg.approveMessage : notifCfg.rejectMessage,
    {
      tim: reg.team_name,
      turnamen: trn.title,
      kapten: `<@${reg.captain_discord_id}>`,
      alasan: reg.reject_reason || 'Data belum memenuhi syarat.',
    }
  );

  // 1. Send DM to Captain / Participant
  if (notifCfg.sendDm) {
    try {
      const user = await client.users.fetch(reg.captain_discord_id);
      const embed = new EmbedBuilder()
        .setTitle(
          decision === 'approved'
            ? `✅ Pendaftaran Diterima — ${trn.title}`
            : `❌ Pendaftaran Ditolak — ${trn.title}`
        )
        .setColor(decision === 'approved' ? 0x10b981 : 0xef4444)
        .setDescription(formattedMsg)
        .setFooter({ text: 'Tim Humas & Panitia Turnamen' })
        .setTimestamp();
      await user.send({ embeds: [embed] });
      dmSent = true;
    } catch {
      // Ignore if DMs closed
    }
  }

  // 2. If Approved: assign optional Participant Role + post to configured Approve Notif Channel
  if (decision === 'approved') {
    if (trn.participant_role_id && config.guildId) {
      try {
        const guild = await client.guilds.fetch(config.guildId);
        const member = await guild.members.fetch(reg.captain_discord_id).catch(() => null);
        if (member) {
          await member.roles.add(trn.participant_role_id, `Peserta Turnamen ${trn.title}`);
          roleAssigned = true;
        }
      } catch {
        // Ignore role error
      }
    }

    if (notifCfg.announceChannelId) {
      try {
        const ch = await client.channels.fetch(notifCfg.announceChannelId);
        if (ch && ch.isTextBased() && 'send' in ch) {
          const latestTrn = getTournamentById(trn.id) || trn;
          const embed = new EmbedBuilder()
            .setTitle(`✅ Peserta Terkonfirmasi — ${trn.title}`)
            .setColor(0x10b981)
            .setDescription(formattedMsg)
            .addFields(
              {
                name: trn.mode === 'team' ? '🏷️ Nama Tim' : '👤 Peserta',
                value: reg.team_name,
                inline: true,
              },
              {
                name: '👑 Perwakilan / Kapten',
                value: `<@${reg.captain_discord_id}>`,
                inline: true,
              },
              {
                name: '📊 Slot Terisi',
                value: `${latestTrn.approved_count || 0} / ${latestTrn.max_slots}`,
                inline: true,
              }
            )
            .setTimestamp();
          await ch.send({ embeds: [embed] });
          channelNotified = true;
        }
      } catch (err) {
        console.error('[Tournament] Gagal kirim notif approve ke channel:', err);
      }
    }
  }

  // 3. Refresh original tournament panel message counter
  await refreshTournamentPanelMessage(client, trn.id);

  return { dmSent, channelNotified, roleAssigned };
}

// Slash command /turnamen-notif (Admin only)
export async function handleTournamentNotifCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: '❌ Command ini hanya bisa digunakan oleh Admin (Manage Server).',
      ephemeral: true,
    });
    return;
  }

  const channel = interaction.options.getChannel('channel');
  const clearChannel = interaction.options.getBoolean('matikan_channel');
  const sendDm = interaction.options.getBoolean('kirim_dm');
  const approveMsg = interaction.options.getString('pesan_approve');
  const rejectMsg = interaction.options.getString('pesan_reject');

  const updates: Partial<ReturnType<typeof getTournamentNotifSettings>> = {};
  if (clearChannel) updates.announceChannelId = '';
  else if (channel) updates.announceChannelId = channel.id;
  if (sendDm !== null) updates.sendDm = sendDm;
  if (approveMsg) updates.approveMessage = approveMsg;
  if (rejectMsg) updates.rejectMessage = rejectMsg;

  const saved = saveTournamentNotifSettings(updates);

  const embed = new EmbedBuilder()
    .setTitle('⚙️ Pengaturan Notifikasi Approve Turnamen')
    .setColor(0x6366f1)
    .addFields(
      {
        name: '📢 Channel Notif Approve',
        value: saved.announceChannelId ? `<#${saved.announceChannelId}>` : '*Tidak diatur (nonaktif)*',
        inline: true,
      },
      {
        name: '📩 Kirim DM ke Perwakilan',
        value: saved.sendDm ? '✅ Aktif' : '❌ Nonaktif',
        inline: true,
      },
      {
        name: '✅ Template Pesan Approve',
        value: saved.approveMessage.slice(0, 500),
      },
      {
        name: '❌ Template Pesan Reject',
        value: saved.rejectMessage.slice(0, 500),
      }
    )
    .setFooter({ text: 'Variabel tersedia: {tim}, {turnamen}, {kapten}, {alasan}' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

function buildRegistrationModal(trn: Tournament): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`trn_modal_${trn.id}`)
    .setTitle(`Daftar: ${trn.title}`.slice(0, 45));

  if (trn.mode === 'team') {
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('team_name')
          .setLabel('Nama Tim')
          .setPlaceholder('Contoh: Murphy Esports')
          .setMaxLength(60)
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('rep_contact')
          .setLabel('Nama Perwakilan / Kapten & Kontak (WA/IG)')
          .setPlaceholder('Contoh: Budi / 08123456789')
          .setMaxLength(80)
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('roster')
          .setLabel('Daftar Member / Roster (Nick + ID Game)')
          .setPlaceholder(
            '1. Nick1 (ID/RiotID)\n2. Nick2 (ID/RiotID)\n3. Nick3 (ID)\n4. Nick4 (ID)\n5. Nick5 (ID)'
          )
          .setMaxLength(800)
          .setRequired(true)
          .setStyle(TextInputStyle.Paragraph)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('subs')
          .setLabel('Pemain Cadangan (Opsional)')
          .setPlaceholder('Contoh: Nick6 (ID) - kosongkan jika tidak ada')
          .setMaxLength(200)
          .setRequired(false)
          .setStyle(TextInputStyle.Short)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('notes')
          .setLabel('Catatan Tambahan (Opsional)')
          .setPlaceholder('Misal: Tag Discord anggota atau info lainnya')
          .setMaxLength(200)
          .setRequired(false)
          .setStyle(TextInputStyle.Short)
      )
    );
  } else {
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('team_name')
          .setLabel('Nickname In-Game')
          .setPlaceholder('Contoh: Shynx#1234')
          .setMaxLength(60)
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('roster')
          .setLabel('ID Game / Riot ID / Server')
          .setPlaceholder('Contoh: 12345678 (2024)')
          .setMaxLength(150)
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('subs')
          .setLabel('Rank / Tier Saat Ini (Opsional)')
          .setPlaceholder('Contoh: Mythic / Ascendant')
          .setMaxLength(60)
          .setRequired(false)
          .setStyle(TextInputStyle.Short)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('rep_contact')
          .setLabel('Kontak (WA / IG Opsional)')
          .setMaxLength(80)
          .setRequired(false)
          .setStyle(TextInputStyle.Short)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('notes')
          .setLabel('Catatan Tambahan (Opsional)')
          .setMaxLength(200)
          .setRequired(false)
          .setStyle(TextInputStyle.Short)
      )
    );
  }

  return modal;
}

export async function handleTournamentDaftarAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const query = interaction.options.getFocused().toLowerCase();
  const openList = listTournaments().filter((t) => t.is_open === 1);
  const choices = openList
    .filter(
      (t) =>
        t.title.toLowerCase().includes(query) ||
        t.game.toLowerCase().includes(query)
    )
    .slice(0, 25)
    .map((t) => ({
      name: `${t.title} (${t.game} • ${t.approved_count || 0}/${t.max_slots})`.slice(0, 100),
      value: String(t.id),
    }));
  await interaction.respond(choices);
}

export async function handleTournamentDaftarCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const rawId = interaction.options.getString('turnamen');
  const openList = listTournaments().filter((t) => t.is_open === 1);

  if (openList.length === 0) {
    await interaction.reply({
      content: '🔒 Saat ini belum ada turnamen yang sedang membuka pendaftaran.',
      ephemeral: true,
    });
    return;
  }

  let trn: Tournament | undefined;
  if (rawId) {
    trn = getTournamentById(Number(rawId));
  } else if (openList.length === 1) {
    trn = openList[0];
  } else {
    const listText = openList
      .map((t) => `• **${t.title}** (${t.game} • ${t.approved_count || 0}/${t.max_slots})`)
      .join('\n');
    await interaction.reply({
      content: `Ada beberapa turnamen yang sedang dibuka. Jalankan \`/daftar\` lalu pilih nama turnamennya:\n\n${listText}`,
      ephemeral: true,
    });
    return;
  }

  if (!trn || trn.is_open === 0) {
    await interaction.reply({
      content: '🔒 Pendaftaran turnamen tersebut tidak ditemukan atau sudah ditutup.',
      ephemeral: true,
    });
    return;
  }
  if ((trn.approved_count || 0) >= trn.max_slots) {
    await interaction.reply({
      content: `⚠️ Slot turnamen **${trn.title}** sudah penuh (${trn.max_slots}/${trn.max_slots}).`,
      ephemeral: true,
    });
    return;
  }
  const existing = findExistingRegistration(trn.id, interaction.user.id);
  if (existing) {
    await interaction.reply({
      content: `ℹ️ Kamu sudah mendaftar di **${trn.title}** sebagai **${existing.team_name}** (Status: **${existing.status.toUpperCase()}**).`,
      ephemeral: true,
    });
    return;
  }

  await interaction.showModal(buildRegistrationModal(trn));
}

// Handle buttons (trn_register_<id>, trn_list_<id>) and modal submit (trn_modal_<id>)
export async function handleTournamentInteraction(
  interaction: Interaction,
  sendInternalNotif: (title: string, desc: string, url?: string) => Promise<void>
): Promise<boolean> {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return false;
  const customId = interaction.customId || '';
  if (!customId.startsWith('trn_')) return false;

  // ---- BUTTON: LIHAT PESERTA ----
  if (interaction.isButton() && customId.startsWith('trn_list_')) {
    const trnId = Number(customId.replace('trn_list_', ''));
    const trn = getTournamentById(trnId);
    if (!trn) {
      await interaction.reply({ content: '❌ Turnamen tidak ditemukan.', ephemeral: true });
      return true;
    }
    const regs = listTournamentRegistrations(trnId).filter((r) => r.status === 'approved');
    const lines =
      regs.length > 0
        ? regs.map((r, i) => `\`${i + 1}.\` **${r.team_name}** — <@${r.captain_discord_id}>`).join('\n')
        : '*Belum ada peserta yang disetujui.*';

    const embed = new EmbedBuilder()
      .setTitle(`📋 Daftar Peserta — ${trn.title}`)
      .setColor(0x6366f1)
      .setDescription(
        `Slot Terisi: **${regs.length} / ${trn.max_slots}**\n\n${lines}`
      );
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return true;
  }

  // ---- BUTTON: DAFTAR SEKARANG (SHOW MODAL) ----
  if (interaction.isButton() && customId.startsWith('trn_register_')) {
    const trnId = Number(customId.replace('trn_register_', ''));
    const trn = getTournamentById(trnId);
    if (!trn || trn.is_open === 0) {
      await interaction.reply({ content: '🔒 Pendaftaran turnamen ini sudah ditutup.', ephemeral: true });
      return true;
    }
    if ((trn.approved_count || 0) >= trn.max_slots) {
      await interaction.reply({ content: '⚠️ Slot turnamen ini sudah penuh.', ephemeral: true });
      return true;
    }
    const existing = findExistingRegistration(trnId, interaction.user.id);
    if (existing) {
      await interaction.reply({
        content: `ℹ️ Kamu sudah mendaftar sebagai **${existing.team_name}** (Status: **${existing.status.toUpperCase()}**).`,
        ephemeral: true,
      });
      return true;
    }

    await interaction.showModal(buildRegistrationModal(trn));
    return true;
  }

  // ---- MODAL SUBMIT ----
  if (interaction.isModalSubmit() && customId.startsWith('trn_modal_')) {
    const trnId = Number(customId.replace('trn_modal_', ''));
    const trn = getTournamentById(trnId);
    if (!trn || trn.is_open === 0) {
      await interaction.reply({ content: '🔒 Pendaftaran turnamen ini sudah ditutup.', ephemeral: true });
      return true;
    }

    const teamName = interaction.fields.getTextInputValue('team_name').trim();
    const repContact = interaction.fields.getTextInputValue('rep_contact')?.trim() || '';
    const rosterText = interaction.fields.getTextInputValue('roster').trim();
    const subs = interaction.fields.getTextInputValue('subs')?.trim() || '';
    const notes = interaction.fields.getTextInputValue('notes')?.trim() || '';

    const reg = createTournamentRegistration({
      tournament_id: trnId,
      captain_discord_id: interaction.user.id,
      captain_username: interaction.user.username,
      team_name: teamName,
      representative_contact: repContact,
      roster_text: rosterText,
      substitutes: subs,
      notes,
    });

    await interaction.reply({
      content: `✅ Pendaftaran **${reg.team_name}** untuk turnamen **${trn.title}** berhasil dikirim!\nStatus saat ini: **Menunggu Verifikasi Admin**. Kamu akan mendapat notifikasi setelah disetujui.`,
      ephemeral: true,
    });

    emitNotification({
      type: 'rsvp',
      title: `🏆 Pendaftar Baru: ${trn.title}`,
      body: `${reg.team_name} (Perwakilan: ${interaction.user.username})`,
    });

    await sendInternalNotif(
      `🏆 Pendaftar Turnamen Baru — ${trn.title}`,
      `**${trn.mode === 'team' ? 'Tim' : 'Peserta'}:** ${reg.team_name}\n**Perwakilan:** ${interaction.user.username} (<@${interaction.user.id}>)\n**Kontak:** ${repContact || '-'}\n**Roster/ID:**\n${rosterText.slice(0, 400)}`,
      config.webBaseUrl
    );

    await refreshTournamentPanelMessage(interaction.client, trnId);
    return true;
  }

  return false;
}

