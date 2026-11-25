import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  Routes,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type Role,
} from 'discord.js';
import {
  appendCustomRoleHistory,
  deleteCustomRoleByUserId,
  getCustomRoleByUserId,
  getCustomRoleSettings,
  upsertCustomRole,
} from './db.js';
import type { CustomRoleRecord } from './types.js';

export function normalizeHexColor(input: string | undefined | null): string | null {
  if (!input) return null;
  const cleaned = input.trim().replace(/^#/, '');
  if (/^[0-9A-Fa-f]{3}$/.test(cleaned)) {
    const r = cleaned[0] + cleaned[0];
    const g = cleaned[1] + cleaned[1];
    const b = cleaned[2] + cleaned[2];
    return `#${(r + g + b).toUpperCase()}`;
  }
  if (/^[0-9A-Fa-f]{6}$/.test(cleaned)) {
    return `#${cleaned.toUpperCase()}`;
  }
  return null;
}

export function generateRandomHexColor(): string {
  const n = Math.floor(Math.random() * 0xffffff);
  return `#${n.toString(16).padStart(6, '0').toUpperCase()}`;
}

export function buildRoleUpdatedEmbed(description: string, thumbnailUrl?: string | null): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✅ Custom role updated')
    .setDescription(description);
  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
  return embed;
}

export async function applyRoleColors(
  guild: Guild,
  role: Role,
  primaryHex: string,
  sideHex: string | null = null,
  reason = 'Humas custom role color update'
): Promise<void> {
  const primaryInt = Number.parseInt(primaryHex.replace('#', ''), 16);

  if (sideHex) {
    const secondaryInt = Number.parseInt(sideHex.replace('#', ''), 16);
    try {
      await guild.client.rest.patch(Routes.guildRole(guild.id, role.id), {
        body: {
          color: primaryInt,
          colors: {
            primary_color: primaryInt,
            secondary_color: secondaryInt,
            tertiary_color: null,
          },
        },
        reason,
      });
      return;
    } catch {
      // Fallback to single color if server doesn't support gradient roles
    }
  }

  await role.edit({ color: primaryHex as `#${string}`, reason });
}

export async function positionRoleBelowBot(guild: Guild, role: Role): Promise<Role> {
  try {
    const botMember = guild.members.me || (await guild.members.fetchMe().catch(() => null));
    if (!botMember) return role;

    const cfg = getCustomRoleSettings();
    const highestBotRole = botMember.roles.highest;

    let anchorRole: Role | null = null;
    if (cfg.anchorRoleId) {
      anchorRole =
        guild.roles.cache.get(cfg.anchorRoleId) ||
        (await guild.roles.fetch(cfg.anchorRoleId).catch(() => null));
    }

    if (!anchorRole || anchorRole.position > highestBotRole.position) {
      anchorRole = highestBotRole;
    }

    if (!anchorRole || anchorRole.position <= 1) return role;

    const targetPosition =
      role.position < anchorRole.position
        ? Math.max(1, anchorRole.position - 1)
        : Math.max(1, anchorRole.position);

    if (role.position === targetPosition) return role;

    try {
      await role.setPosition(targetPosition, {
        reason: `Auto-position Custom Role tepat di bawah ${anchorRole.name}`,
      });
      return role;
    } catch {
      const rawTarget = Math.max(1, (anchorRole.rawPosition || anchorRole.position) - 1);
      await guild.client.rest
        .patch(Routes.guildRoles(guild.id), {
          body: [{ id: role.id, position: rawTarget }],
          reason: `Auto-position Custom Role tepat di bawah ${anchorRole.name}`,
        })
        .catch(() => {});
      return role;
    }
  } catch {
    return role;
  }
}

export async function setRoleIconFromUrl(
  role: Role,
  imageUrl: string,
  reason = 'Custom role icon update'
): Promise<{ appliedToDiscordRole: boolean; imageUrl: string }> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error('Gagal mengunduh gambar dari URL tersebut.');
  const contentType = res.headers.get('content-type') || '';
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error('URL tersebut bukan file gambar yang valid (PNG/JPG/WEBP/GIF).');
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > 4 * 1024 * 1024) {
    throw new Error('Ukuran gambar terlalu besar (maksimal 4 MB).');
  }

  let appliedToDiscordRole = false;
  try {
    await role.setIcon(buffer, reason);
    appliedToDiscordRole = true;
  } catch {
    // Server might not have Boost Level 2 yet; keep thumbnail in info card
  }
  return { appliedToDiscordRole, imageUrl };
}

export function resolveIconInputUrl(input: string | undefined | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const emojiMatch = trimmed.match(/^<a?:[a-zA-Z0-9_]+:(\d{17,20})>$/);
  if (emojiMatch) {
    return `https://cdn.discordapp.com/emojis/${emojiMatch[1]}.png?size=256`;
  }
  if (/^https?:\/\/\S+/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

export function isMemberBooster(member: GuildMember | null | undefined): boolean {
  if (!member) return false;
  return Boolean(member.premiumSince);
}

export function isEligibleForCustomRole(
  member: GuildMember | null | undefined,
  existingRecord?: CustomRoleRecord
): { eligible: boolean; source: 'booster' | 'admin_grant' | null } {
  if (existingRecord?.source === 'admin_grant') {
    return { eligible: true, source: 'admin_grant' };
  }
  if (isMemberBooster(member)) {
    return { eligible: true, source: 'booster' };
  }
  return { eligible: false, source: null };
}

function syncSharedMembers(guild: Guild, role: Role, record: CustomRoleRecord): CustomRoleRecord {
  const validShared = record.shared_with.filter((uid) => {
    if (uid === record.discord_user_id) return false;
    const m = guild.members.cache.get(uid);
    return m ? m.roles.cache.has(role.id) : true;
  });

  if (validShared.length !== record.shared_with.length) {
    return upsertCustomRole({
      discord_user_id: record.discord_user_id,
      shared_with: validShared,
    });
  }
  return record;
}

export async function buildCustomRoleInfoPayload(
  guild: Guild,
  ownerId: string,
  mode: 'view' | 'edit' = 'view'
) {
  const cfg = getCustomRoleSettings();
  const member =
    guild.members.cache.get(ownerId) || (await guild.members.fetch(ownerId).catch(() => null));
  let record = getCustomRoleByUserId(ownerId);
  const eligibility = isEligibleForCustomRole(member, record);
  const role = record?.role_id
    ? guild.roles.cache.get(record.role_id) ||
      (await guild.roles.fetch(record.role_id).catch(() => null))
    : null;

  // No active custom role yet
  if (!record || !role) {
    const statusLine = eligibility.eligible
      ? eligibility.source === 'booster'
        ? '💎 Status: **Server Booster Aktif** — kamu berhak membuat Custom Role gratis selama masa boost!'
        : '🎁 Status: **Akses Benefit Humas Aktif** — kamu berhak membuat Custom Role!'
      : '🔒 Fitur Custom Role ini khusus untuk **Server Booster** atau penerima **Benefit dari Tim Humas**.';

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle('ℹ️ Custom Role Information')
      .setDescription(
        [
          `<@${ownerId}> belum memiliki Custom Role aktif di server ini.`,
          '',
          statusLine,
          '',
          `> 🎨 **Kustomisasi:** Nama, 1/2 Warna Gradasi, Icon, Banner, Deskripsi`,
          `> 🤝 **Kuota Share Teman:** Hingga **${record?.max_shares ?? cfg.defaultMaxShares} orang**`,
          `> ⏳ **Durasi:** Mengikuti status **Server Booster** otomatis dari Discord`,
          `> ⚡ **Shortcut:** \`/mrole\`, \`!mrole\`, \`!mcolor\`, \`!micon\`, \`!mname\`, \`!mshare\``,
        ].join('\n')
      );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`hcr_btn_create_${ownerId}`)
        .setLabel('Buat Custom Role')
        .setEmoji('🎨')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!cfg.enabled || !eligibility.eligible)
    );

    return { embeds: [embed], components: [row] };
  }

  record = syncSharedMembers(guild, role, record);
  const isEquipped = member ? member.roles.cache.has(role.id) : true;

  const primaryHex = (record.color || role.hexColor || '#CECECE').toUpperCase();
  const sideHex = record.side_color ? record.side_color.toUpperCase() : null;
  const colorDisplay = sideHex ? `${primaryHex} ${sideHex}` : primaryHex;

  const discordIconUrl = role.iconURL({ extension: 'png', size: 256 });
  const effectiveIconUrl = discordIconUrl || record.icon_url || null;
  const hasIcon = Boolean(effectiveIconUrl || role.unicodeEmoji);
  const hasBanner = Boolean(record.banner_url);
  const isHoisted = Boolean(role.hoist);

  const sharedCount = record.shared_with.length;
  const maxShares = record.max_shares ?? cfg.defaultMaxShares;
  const memberCount = Math.max(role.members.size, (isEquipped ? 1 : 0) + sharedCount);
  const createdSec = Math.floor(new Date(record.created_at + 'Z').getTime() / 1000);
  const durationLabel =
    record.source === 'booster'
      ? '💎 Otomatis selama **Server Booster** aktif'
      : '🎁 **Benefit Humas** (dikelola admin)';

  const infoLines = [
    `👑 Owned by <@${ownerId}>`,
    '',
    '**Description**',
    record.description || 'Custom Role eksklusif Booster & Benefit Server.',
    '',
    `> Role Name: **${role.name}**`,
    `> Role Mention: ${role}`,
    `> Color: \`${colorDisplay}\``,
    `> 🔘 Side Color: \`${sideHex || 'None'}\``,
    `> 🔘 Icon: **${hasIcon ? 'Yes' : 'No'}**`,
    `> 🔘 Banner: **${hasBanner ? 'Yes' : 'No'}**`,
    `> 🔘 Hoisted: **${isHoisted ? 'Yes' : 'No'}**`,
    `> Members: **${memberCount}**`,
    `> Shared: **${sharedCount} / ${maxShares}**`,
    `> Duration: ${durationLabel}`,
    `> Created At: <t:${createdSec}:R>`,
  ];

  const mainEmbed = new EmbedBuilder()
    .setColor(role.color || 0x2b2d31)
    .setTitle('ℹ️ Custom Role Information')
    .setDescription(infoLines.join('\n'));

  if (effectiveIconUrl) mainEmbed.setThumbnail(effectiveIconUrl);
  if (record.banner_url) mainEmbed.setImage(record.banner_url);

  if (mode === 'view') {
    const viewRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`hcr_mode_edit_${ownerId}`)
        .setLabel('Edit Mode')
        .setEmoji('✏️')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`hcr_btn_share_${ownerId}`)
        .setLabel(`Share (${sharedCount}/${maxShares})`)
        .setEmoji('🤝')
        .setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [mainEmbed], components: [viewRow] };
  }

  // Edit Mode
  const editEmbed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setDescription(
      `✏️ **Edit Mode** — Semua kustomisasi gratis!\nShortcut cepat: \`!mname\`, \`!mcolor #HEX1 #HEX2\`, \`!micon\`, \`!mshare @user\`, \`!munshare @user\``
    );

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`hcr_btn_name_${ownerId}`).setLabel('Name').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`hcr_btn_color_${ownerId}`).setLabel('Color').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`hcr_btn_randcolor_${ownerId}`).setLabel('Random Color').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`hcr_btn_sidecolor_${ownerId}`).setLabel('Side Color').setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`hcr_btn_icon_${ownerId}`).setLabel('Icon').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`hcr_btn_banner_${ownerId}`).setLabel('Banner').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`hcr_btn_desc_${ownerId}`).setLabel('Description').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`hcr_btn_hoist_${ownerId}`)
      .setLabel(cfg.allowHoist ? 'Hoist' : 'Hoist (Off)')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!cfg.allowHoist)
  );

  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`hcr_btn_share_${ownerId}`).setLabel(`Share (${sharedCount}/${maxShares})`).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`hcr_btn_history_${ownerId}`).setLabel('History').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`hcr_btn_equip_${ownerId}`)
      .setLabel(isEquipped ? 'Unequip' : 'Equip')
      .setStyle(isEquipped ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`hcr_btn_delete_${ownerId}`).setEmoji('🗑️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`hcr_mode_view_${ownerId}`).setEmoji('⬅️').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [mainEmbed, editEmbed], components: [row1, row2, row3] };
}

export async function handleCustomRoleInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.guild) return false;
  if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isUserSelectMenu()) {
    return false;
  }

  const customId = interaction.customId || '';
  if (!customId.startsWith('hcr_')) return false;

  const guild = interaction.guild;
  const parts = customId.split('_');
  const ownerId = parts[parts.length - 1];
  const action = parts.slice(1, -1).join('_');

  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: `❌ Hanya pemilik Custom Role ini (<@${ownerId}>) yang bisa menggunakan tombol ini.`,
      ephemeral: true,
    });
    return true;
  }

  const cfg = getCustomRoleSettings();
  const member =
    guild.members.cache.get(ownerId) || (await guild.members.fetch(ownerId).catch(() => null));
  const existingRecord = getCustomRoleByUserId(ownerId);
  const eligibility = isEligibleForCustomRole(member, existingRecord);

  // ---- CREATE ROLE MODAL ----
  if (interaction.isButton() && action === 'btn_create') {
    if (!cfg.enabled || !eligibility.eligible) {
      await interaction.reply({
        content: '🔒 Custom Role khusus untuk **Server Booster** atau penerima **Benefit Humas**.',
        ephemeral: true,
      });
      return true;
    }

    const modal = new ModalBuilder()
      .setCustomId(`hcr_modal_create_${ownerId}`)
      .setTitle('Buat Custom Role');

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('role_name')
          .setLabel('Nama Custom Role')
          .setPlaceholder('Contoh: starlight')
          .setMinLength(1)
          .setMaxLength(50)
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('role_color')
          .setLabel('Warna Hex (#HEX1 atau #HEX1 #HEX2)')
          .setPlaceholder('#CECECE atau #FFFFF0 #AA8668')
          .setMinLength(4)
          .setMaxLength(20)
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('role_desc')
          .setLabel('Deskripsi Singkat (Opsional)')
          .setMaxLength(150)
          .setRequired(false)
          .setStyle(TextInputStyle.Short)
      )
    );

    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && action === 'modal_create') {
    await interaction.deferUpdate();
    if (!cfg.enabled || !eligibility.eligible || !eligibility.source) {
      await interaction.followUp({
        content: '🔒 Kamu belum memenuhi syarat (khusus Server Booster / Benefit Humas).',
        ephemeral: true,
      });
      return true;
    }

    const rawName = interaction.fields.getTextInputValue('role_name').trim();
    const rawColorTokens = interaction.fields.getTextInputValue('role_color').trim().split(/\s+/);
    const rawDesc = interaction.fields.getTextInputValue('role_desc')?.trim() || '';

    const primaryHex = normalizeHexColor(rawColorTokens[0]);
    const sideHex = rawColorTokens[1] ? normalizeHexColor(rawColorTokens[1]) : null;

    if (!rawName || /^@(everyone|here)$/i.test(rawName)) {
      await interaction.followUp({ content: '❌ Nama role tidak valid.', ephemeral: true });
      return true;
    }
    if (!primaryHex || (rawColorTokens[1] && !sideHex)) {
      await interaction.followUp({
        content: '❌ Format warna Hex tidak valid! Contoh: `#CECECE` atau `#FFFFF0 #AA8668`.',
        ephemeral: true,
      });
      return true;
    }

    const botMember = guild.members.me;
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.followUp({
        content: '❌ Bot tidak memiliki izin **Manage Roles**.',
        ephemeral: true,
      });
      return true;
    }

    try {
      const createdRole = await guild.roles.create({
        name: rawName,
        color: primaryHex as `#${string}`,
        permissions: [],
        reason: `Humas Custom Role (${eligibility.source}) dibuat oleh ${interaction.user.tag}`,
      });

      await positionRoleBelowBot(guild, createdRole);
      if (sideHex) {
        await applyRoleColors(guild, createdRole, primaryHex, sideHex);
      }
      if (member) {
        await member.roles.add(createdRole);
      }

      upsertCustomRole({
        discord_user_id: ownerId,
        discord_username: interaction.user.username,
        role_id: createdRole.id,
        source: eligibility.source,
        name: rawName,
        color: primaryHex,
        side_color: sideHex,
        description: rawDesc || 'Custom Role eksklusif Booster & Benefit Server.',
        max_shares: existingRecord?.max_shares ?? cfg.defaultMaxShares,
        shared_with: [],
        history: [{ action: `Created role (${primaryHex})`, timestamp: Date.now() }],
      });

      const payload = await buildCustomRoleInfoPayload(guild, ownerId, 'view');
      await interaction.editReply(payload);
      await interaction.followUp({
        embeds: [buildRoleUpdatedEmbed(`${createdRole} : **Successfully** created your custom role!`)],
        ephemeral: true,
      });
    } catch (err: unknown) {
      await interaction.followUp({
        content: `❌ Gagal membuat Custom Role: ${err instanceof Error ? err.message : 'Unknown error'}`,
        ephemeral: true,
      });
    }
    return true;
  }

  // Must have active role for remaining actions
  const record = getCustomRoleByUserId(ownerId);
  const role = record?.role_id
    ? guild.roles.cache.get(record.role_id) ||
      (await guild.roles.fetch(record.role_id).catch(() => null))
    : null;

  if (!record || !role) {
    const payload = await buildCustomRoleInfoPayload(guild, ownerId, 'view');
    if (interaction.isButton()) {
      await interaction.update(payload);
    } else {
      await interaction.reply({ ...payload, ephemeral: true });
    }
    return true;
  }

  // ---- VIEW <-> EDIT MODE ----
  if (interaction.isButton() && (action === 'mode_edit' || action === 'mode_view')) {
    const payload = await buildCustomRoleInfoPayload(
      guild,
      ownerId,
      action === 'mode_edit' ? 'edit' : 'view'
    );
    await interaction.update(payload);
    return true;
  }

  // ---- NAME ----
  if (interaction.isButton() && action === 'btn_name') {
    const modal = new ModalBuilder()
      .setCustomId(`hcr_modal_name_${ownerId}`)
      .setTitle('Change Custom Role Name')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('new_name')
            .setLabel('Role Name')
            .setValue(role.name)
            .setMinLength(1)
            .setMaxLength(50)
            .setRequired(true)
            .setStyle(TextInputStyle.Short)
        )
      );
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && action === 'modal_name') {
    await interaction.deferUpdate();
    const newName = interaction.fields.getTextInputValue('new_name').trim();
    if (!newName || /^@(everyone|here)$/i.test(newName)) {
      await interaction.followUp({ content: '❌ Nama role tidak valid.', ephemeral: true });
      return true;
    }
    await role.setName(newName, `Diubah oleh ${interaction.user.tag}`);
    upsertCustomRole({ discord_user_id: ownerId, name: newName });
    appendCustomRoleHistory(ownerId, `Changed name to "${newName}"`);
    await interaction.editReply(await buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
    await interaction.followUp({
      embeds: [buildRoleUpdatedEmbed(`${role} : **Successfully** changed name to **${newName}**`)],
      ephemeral: true,
    });
    return true;
  }

  // ---- COLOR ----
  if (interaction.isButton() && action === 'btn_color') {
    const currentVal = record.side_color ? `${record.color} ${record.side_color}` : record.color;
    const modal = new ModalBuilder()
      .setCustomId(`hcr_modal_color_${ownerId}`)
      .setTitle('Change Custom Role Color')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('new_color')
            .setLabel('Hex Color (#HEX1 atau #HEX1 #HEX2)')
            .setValue(currentVal)
            .setMinLength(4)
            .setMaxLength(20)
            .setRequired(true)
            .setStyle(TextInputStyle.Short)
        )
      );
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && action === 'modal_color') {
    await interaction.deferUpdate();
    const tokens = interaction.fields.getTextInputValue('new_color').trim().split(/\s+/);
    const primaryHex = normalizeHexColor(tokens[0]);
    const sideHex = tokens[1] ? normalizeHexColor(tokens[1]) : record.side_color;
    if (!primaryHex || (tokens[1] && !normalizeHexColor(tokens[1]))) {
      await interaction.followUp({
        content: '❌ Kode warna Hex tidak valid! Contoh: `#FFFFF0` atau `#FFFFF0 #AA8668`.',
        ephemeral: true,
      });
      return true;
    }
    await applyRoleColors(guild, role, primaryHex, sideHex, `Diubah oleh ${interaction.user.tag}`);
    upsertCustomRole({ discord_user_id: ownerId, color: primaryHex, side_color: sideHex });
    const displayStr = sideHex ? `${primaryHex} ${sideHex}` : primaryHex;
    appendCustomRoleHistory(ownerId, `Changed color to ${displayStr}`);
    await interaction.editReply(await buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
    await interaction.followUp({
      embeds: [buildRoleUpdatedEmbed(`${role} : **Successfully** changed color to\n\`\`\`\n${displayStr}\n\`\`\``)],
      ephemeral: true,
    });
    return true;
  }

  // ---- RANDOM COLOR ----
  if (interaction.isButton() && action === 'btn_randcolor') {
    await interaction.deferUpdate();
    const randomHex = generateRandomHexColor();
    await applyRoleColors(guild, role, randomHex, record.side_color);
    upsertCustomRole({ discord_user_id: ownerId, color: randomHex });
    appendCustomRoleHistory(ownerId, `Randomized color to ${randomHex}`);
    await interaction.editReply(await buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
    await interaction.followUp({
      embeds: [buildRoleUpdatedEmbed(`${role} : **Successfully** randomized color to \`${randomHex}\``)],
      ephemeral: true,
    });
    return true;
  }

  // ---- SIDE COLOR ----
  if (interaction.isButton() && action === 'btn_sidecolor') {
    const modal = new ModalBuilder()
      .setCustomId(`hcr_modal_sidecolor_${ownerId}`)
      .setTitle('Change Side / Gradient Color')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('new_sidecolor')
            .setLabel('Side Color Hex (Ketik "none" untuk hapus)')
            .setValue(record.side_color || '')
            .setPlaceholder('#363636 atau none')
            .setMaxLength(15)
            .setRequired(true)
            .setStyle(TextInputStyle.Short)
        )
      );
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && action === 'modal_sidecolor') {
    await interaction.deferUpdate();
    const rawVal = interaction.fields.getTextInputValue('new_sidecolor').trim();
    const isClear = /^none|clear|off|reset|-$/i.test(rawVal);
    const sideHex = isClear ? null : normalizeHexColor(rawVal);
    if (!isClear && !sideHex) {
      await interaction.followUp({
        content: '❌ Format Hex tidak valid. Masukkan seperti `#363636` atau ketik `none`.',
        ephemeral: true,
      });
      return true;
    }
    await applyRoleColors(guild, role, record.color, sideHex);
    upsertCustomRole({ discord_user_id: ownerId, side_color: sideHex });
    appendCustomRoleHistory(ownerId, `Set side color to ${sideHex || 'None'}`);
    await interaction.editReply(await buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
    return true;
  }

  // ---- ICON ----
  if (interaction.isButton() && action === 'btn_icon') {
    const modal = new ModalBuilder()
      .setCustomId(`hcr_modal_icon_${ownerId}`)
      .setTitle('Change Custom Role Icon')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('icon_input')
            .setLabel('URL Gambar / Emoji (atau "remove")')
            .setPlaceholder('https://.../icon.png, <:nama:id>, atau !micon + gambar')
            .setValue(record.icon_url || '')
            .setRequired(true)
            .setStyle(TextInputStyle.Short)
        )
      );
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && action === 'modal_icon') {
    await interaction.deferUpdate();
    const rawInput = interaction.fields.getTextInputValue('icon_input').trim();
    if (/^remove|none|delete|clear|off$/i.test(rawInput)) {
      await role.setIcon(null).catch(() => {});
      upsertCustomRole({ discord_user_id: ownerId, icon_url: null });
      appendCustomRoleHistory(ownerId, 'Removed role icon');
      await interaction.editReply(await buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
      return true;
    }
    const resolvedUrl = resolveIconInputUrl(rawInput);
    if (!resolvedUrl) {
      await interaction.followUp({
        content: '❌ Masukkan URL gambar (`https://...`), custom emoji (`<:nama:id>`), atau kirim `!micon` sambil upload gambar!',
        ephemeral: true,
      });
      return true;
    }
    try {
      await setRoleIconFromUrl(role, resolvedUrl);
      upsertCustomRole({ discord_user_id: ownerId, icon_url: resolvedUrl });
      appendCustomRoleHistory(ownerId, 'Changed role icon');
      await interaction.editReply(await buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
    } catch (err: unknown) {
      await interaction.followUp({
        content: `❌ ${err instanceof Error ? err.message : 'Gagal mengubah icon'}`,
        ephemeral: true,
      });
    }
    return true;
  }

  // ---- BANNER ----
  if (interaction.isButton() && action === 'btn_banner') {
    const modal = new ModalBuilder()
      .setCustomId(`hcr_modal_banner_${ownerId}`)
      .setTitle('Change Custom Role Banner')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('banner_input')
            .setLabel('URL Gambar Banner (atau "remove")')
            .setValue(record.banner_url || '')
            .setRequired(true)
            .setStyle(TextInputStyle.Short)
        )
      );
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && action === 'modal_banner') {
    await interaction.deferUpdate();
    const rawInput = interaction.fields.getTextInputValue('banner_input').trim();
    const isRemove = /^remove|none|delete|clear|off$/i.test(rawInput);
    if (!isRemove && !/^https?:\/\/\S+/i.test(rawInput)) {
      await interaction.followUp({ content: '❌ URL banner tidak valid.', ephemeral: true });
      return true;
    }
    upsertCustomRole({ discord_user_id: ownerId, banner_url: isRemove ? null : rawInput });
    appendCustomRoleHistory(ownerId, isRemove ? 'Removed banner' : 'Updated banner');
    await interaction.editReply(await buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
    return true;
  }

  // ---- DESCRIPTION ----
  if (interaction.isButton() && action === 'btn_desc') {
    const modal = new ModalBuilder()
      .setCustomId(`hcr_modal_desc_${ownerId}`)
      .setTitle('Change Custom Role Description')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('desc_input')
            .setLabel('Description')
            .setValue(record.description || '')
            .setMaxLength(200)
            .setRequired(true)
            .setStyle(TextInputStyle.Paragraph)
        )
      );
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && action === 'modal_desc') {
    await interaction.deferUpdate();
    const newDesc = interaction.fields.getTextInputValue('desc_input').trim();
    upsertCustomRole({ discord_user_id: ownerId, description: newDesc });
    appendCustomRoleHistory(ownerId, 'Updated description');
    await interaction.editReply(await buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
    return true;
  }

  // ---- HOIST ----
  if (interaction.isButton() && action === 'btn_hoist') {
    await interaction.deferUpdate();
    if (!cfg.allowHoist) {
      await interaction.followUp({
        content: '🔒 Fitur Hoist sedang dinonaktifkan oleh admin.',
        ephemeral: true,
      });
      return true;
    }
    const nextHoist = !role.hoist;
    await role.setHoist(nextHoist).catch(() => {});
    upsertCustomRole({ discord_user_id: ownerId, hoisted: nextHoist ? 1 : 0 });
    appendCustomRoleHistory(ownerId, `${nextHoist ? 'Enabled' : 'Disabled'} Hoist`);
    await interaction.editReply(await buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
    return true;
  }

  // ---- SHARE (UP TO 10 FRIENDS) ----
  if (interaction.isButton() && action === 'btn_share') {
    const synced = syncSharedMembers(guild, role, record);
    const sharedList = synced.shared_with.map((id) => `<@${id}>`).join(', ') || 'Belum ada';
    const maxShares = synced.max_shares ?? cfg.defaultMaxShares;

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle('🤝 Share Custom Role')
      .setDescription(
        [
          `**Role:** ${role}`,
          `**Kuota Share:** **${synced.shared_with.length} / ${maxShares}** teman`,
          `**Member yang di-share:** ${sharedList}`,
          '',
          `Pilih teman di bawah untuk **menambahkan** atau **melepas** role ${role} (atau ketik \`!mshare @user\` / \`!munshare @user\`).`,
        ].join('\n')
      );

    const userSelect = new UserSelectMenuBuilder()
      .setCustomId(`hcr_select_share_${ownerId}`)
      .setPlaceholder('Pilih member untuk Share / Unshare role ini')
      .setMinValues(1)
      .setMaxValues(1);

    await interaction.reply({
      embeds: [embed],
      components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(userSelect)],
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isUserSelectMenu() && action === 'select_share') {
    const targetUserId = interaction.values[0];
    if (targetUserId === ownerId) {
      await interaction.reply({
        content: '❌ Kamu adalah pemilik role ini (gunakan tombol Equip/Unequip).',
        ephemeral: true,
      });
      return true;
    }

    const targetMember =
      guild.members.cache.get(targetUserId) ||
      (await guild.members.fetch(targetUserId).catch(() => null));
    if (!targetMember || targetMember.user.bot) {
      await interaction.reply({ content: '❌ Member tidak valid atau bot.', ephemeral: true });
      return true;
    }

    const synced = syncSharedMembers(guild, role, record);
    const currentShared = new Set(synced.shared_with);
    const alreadyHas = currentShared.has(targetUserId) || targetMember.roles.cache.has(role.id);

    if (alreadyHas) {
      await targetMember.roles.remove(role, `Unshared oleh ${interaction.user.tag}`).catch(() => {});
      currentShared.delete(targetUserId);
      upsertCustomRole({ discord_user_id: ownerId, shared_with: Array.from(currentShared) });
      appendCustomRoleHistory(ownerId, `Removed shared role from <@${targetUserId}>`);
      await interaction.update({
        embeds: [buildRoleUpdatedEmbed(`Role ${role} removed from <@${targetUserId}>`)],
        components: [],
      });
      return true;
    }

    const maxShares = synced.max_shares ?? cfg.defaultMaxShares;
    if (currentShared.size >= maxShares) {
      await interaction.update({
        content: `❌ Kuota Share sudah penuh (**${currentShared.size} / ${maxShares} teman**). Lepas salah satu dulu untuk menambah yang baru.`,
        embeds: [],
        components: [],
      });
      return true;
    }

    await targetMember.roles.add(role, `Shared oleh ${interaction.user.tag}`);
    currentShared.add(targetUserId);
    upsertCustomRole({ discord_user_id: ownerId, shared_with: Array.from(currentShared) });
    appendCustomRoleHistory(ownerId, `Shared role to <@${targetUserId}>`);
    await interaction.update({
      embeds: [buildRoleUpdatedEmbed(`Role ${role} added to <@${targetUserId}>`)],
      components: [],
    });
    return true;
  }

  // ---- HISTORY ----
  if (interaction.isButton() && action === 'btn_history') {
    const lines =
      record.history.length > 0
        ? record.history
            .slice()
            .reverse()
            .map((h) => `• <t:${Math.floor(h.timestamp / 1000)}:R> — ${h.action}`)
            .join('\n')
        : '*Belum ada riwayat perubahan.*';
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2b2d31)
          .setTitle(`📜 Custom Role History — ${role.name}`)
          .setDescription(lines),
      ],
      ephemeral: true,
    });
    return true;
  }

  // ---- EQUIP / UNEQUIP ----
  if (interaction.isButton() && action === 'btn_equip') {
    await interaction.deferUpdate();
    if (!member) return true;
    const equipped = member.roles.cache.has(role.id);
    if (equipped) {
      await member.roles.remove(role).catch(() => {});
    } else {
      await member.roles.add(role).catch(() => {});
    }
    await interaction.editReply(await buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
    return true;
  }

  // ---- DELETE ----
  if (interaction.isButton() && action === 'btn_delete') {
    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`hcr_confirm_delete_${ownerId}`)
        .setLabel('Ya, Hapus Permanen')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`hcr_cancel_delete_${ownerId}`)
        .setLabel('Batal')
        .setStyle(ButtonStyle.Secondary)
    );
    await interaction.reply({
      content: `⚠️ Yakin ingin menghapus Custom Role ${role} secara permanen?`,
      components: [confirmRow],
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isButton() && action === 'confirm_delete') {
    const roleName = role.name;
    await role.delete(`Dihapus oleh pemilik ${interaction.user.tag}`).catch(() => {});
    if (record.source === 'admin_grant') {
      // Keep admin grant eligibility, clear role_id
      upsertCustomRole({ discord_user_id: ownerId, role_id: null, shared_with: [] });
    } else {
      deleteCustomRoleByUserId(ownerId);
    }
    await interaction.update({
      content: null,
      embeds: [buildRoleUpdatedEmbed(`**${roleName}** : **Successfully** deleted custom role`)],
      components: [],
    });
    return true;
  }

  if (interaction.isButton() && action === 'cancel_delete') {
    await interaction.update({ content: '✅ Penghapusan dibatalkan.', components: [] });
    return true;
  }

  return false;
}

// Prefix shortcuts (!mrole, !mcolor, !micon, !mname, !mshare, !munshare)
export async function handleCustomRolePrefixCommand(message: Message): Promise<boolean> {
  if (!message.guild || message.author.bot) return false;
  if (!message.content.startsWith('!')) return false;

  const parts = message.content.slice(1).trim().split(/\s+/);
  const cmd = (parts.shift() || '').toLowerCase();
  const allowed = ['mrole', 'mcolor', 'micon', 'mname', 'mshare', 'munshare'];
  if (!allowed.includes(cmd)) return false;

  const guild = message.guild;
  const userId = message.author.id;
  const cfg = getCustomRoleSettings();

  if (cmd === 'mrole') {
    const targetMention = message.mentions.users.first();
    const targetId = targetMention ? targetMention.id : userId;
    const payload = await buildCustomRoleInfoPayload(guild, targetId, 'view');
    await message.reply({ ...payload, allowedMentions: { repliedUser: false } });
    return true;
  }

  const record = getCustomRoleByUserId(userId);
  const role = record?.role_id
    ? guild.roles.cache.get(record.role_id) ||
      (await guild.roles.fetch(record.role_id).catch(() => null))
    : null;

  if (!record || !role) {
    const payload = await buildCustomRoleInfoPayload(guild, userId, 'view');
    await message.reply({
      content: '❌ Kamu belum memiliki Custom Role aktif. Gunakan tombol di bawah ini:',
      ...payload,
      allowedMentions: { repliedUser: false },
    });
    return true;
  }

  if (cmd === 'mname') {
    const newName = parts.join(' ').trim();
    if (!newName || newName.length > 50 || /^@(everyone|here)$/i.test(newName)) {
      await message.reply({
        content: '💡 Penggunaan: `!mname <nama role baru>` (maks 50 karakter)',
        allowedMentions: { repliedUser: false },
      });
      return true;
    }
    await role.setName(newName, `Diubah oleh ${message.author.tag}`);
    upsertCustomRole({ discord_user_id: userId, name: newName });
    appendCustomRoleHistory(userId, `Changed name to "${newName}"`);
    await message.reply({
      embeds: [buildRoleUpdatedEmbed(`${role} : **Successfully** changed name to **${newName}**`)],
      allowedMentions: { repliedUser: false },
    });
    return true;
  }

  if (cmd === 'mcolor') {
    if (parts.length === 0) {
      await message.reply({
        content: '💡 Penggunaan: `!mcolor #HEX1` atau `!mcolor #HEX1 #HEX2`',
        allowedMentions: { repliedUser: false },
      });
      return true;
    }
    const primaryHex = normalizeHexColor(parts[0]);
    const sideHex = parts[1] ? normalizeHexColor(parts[1]) : null;
    if (!primaryHex || (parts[1] && !sideHex)) {
      await message.reply({
        content: '❌ Kode warna Hex tidak valid! Contoh: `!mcolor #FFFFF0 #AA8668`',
        allowedMentions: { repliedUser: false },
      });
      return true;
    }
    await applyRoleColors(guild, role, primaryHex, sideHex, `Diubah oleh ${message.author.tag}`);
    upsertCustomRole({ discord_user_id: userId, color: primaryHex, side_color: sideHex });
    const displayStr = sideHex ? `${primaryHex} ${sideHex}` : primaryHex;
    appendCustomRoleHistory(userId, `Changed color to ${displayStr}`);
    await message.reply({
      embeds: [
        buildRoleUpdatedEmbed(`${role} : **Successfully** changed color to\n\`\`\`\n${displayStr}\n\`\`\``),
      ],
      allowedMentions: { repliedUser: false },
    });
    return true;
  }

  if (cmd === 'micon') {
    const attachment = message.attachments.first();
    const arg = parts[0]?.trim();
    const targetUrl = attachment?.url || resolveIconInputUrl(arg);

    if (targetUrl) {
      try {
        await setRoleIconFromUrl(role, targetUrl, `Diubah oleh ${message.author.tag}`);
        upsertCustomRole({ discord_user_id: userId, icon_url: targetUrl });
        appendCustomRoleHistory(userId, 'Changed role icon');
        await message.reply({
          embeds: [buildRoleUpdatedEmbed(`${role} : **Successfully** changed the role icon`, targetUrl)],
          allowedMentions: { repliedUser: false },
        });
      } catch (err: unknown) {
        await message.reply({
          content: `❌ ${err instanceof Error ? err.message : 'Gagal memasang icon'}`,
          allowedMentions: { repliedUser: false },
        });
      }
      return true;
    }

    if (!arg || /^remove|none|delete|clear|off$/i.test(arg)) {
      await role.setIcon(null).catch(() => {});
      upsertCustomRole({ discord_user_id: userId, icon_url: null });
      appendCustomRoleHistory(userId, 'Removed role icon');
      await message.reply({
        embeds: [buildRoleUpdatedEmbed(`${role} : **Successfully** removed the role icon`)],
        allowedMentions: { repliedUser: false },
      });
      return true;
    }

    await message.reply({
      content: '💡 Kirim `!micon` sambil upload gambar, atau `!micon <emoji/url>`!',
      allowedMentions: { repliedUser: false },
    });
    return true;
  }

  if (cmd === 'mshare' || cmd === 'munshare') {
    const targetUser = message.mentions.users.first();
    if (!targetUser || targetUser.bot || targetUser.id === userId) {
      await message.reply({
        content: `💡 Penggunaan: \`!${cmd} @teman\``,
        allowedMentions: { repliedUser: false },
      });
      return true;
    }

    const targetMember =
      guild.members.cache.get(targetUser.id) ||
      (await guild.members.fetch(targetUser.id).catch(() => null));
    if (!targetMember) {
      await message.reply({ content: '❌ Member tidak ditemukan.', allowedMentions: { repliedUser: false } });
      return true;
    }

    const synced = syncSharedMembers(guild, role, record);
    const currentShared = new Set(synced.shared_with);

    if (cmd === 'munshare') {
      await targetMember.roles.remove(role).catch(() => {});
      currentShared.delete(targetUser.id);
      upsertCustomRole({ discord_user_id: userId, shared_with: Array.from(currentShared) });
      appendCustomRoleHistory(userId, `Removed shared role from <@${targetUser.id}>`);
      await message.reply({
        embeds: [buildRoleUpdatedEmbed(`Role ${role} removed from ${targetUser}`)],
        allowedMentions: { repliedUser: false },
      });
      return true;
    }

    const maxShares = synced.max_shares ?? cfg.defaultMaxShares;
    if (currentShared.size >= maxShares && !currentShared.has(targetUser.id)) {
      await message.reply({
        content: `❌ Kuota Share penuh (**${currentShared.size} / ${maxShares} teman**).`,
        allowedMentions: { repliedUser: false },
      });
      return true;
    }

    await targetMember.roles.add(role, `Shared oleh ${message.author.tag}`);
    currentShared.add(targetUser.id);
    upsertCustomRole({ discord_user_id: userId, shared_with: Array.from(currentShared) });
    appendCustomRoleHistory(userId, `Shared role to <@${targetUser.id}>`);
    await message.reply({
      embeds: [buildRoleUpdatedEmbed(`Role ${role} added to ${targetUser}`)],
      allowedMentions: { repliedUser: false },
    });
    return true;
  }

  return false;
}

// Auto-cleanup when a Server Booster stops boosting
export async function handleBoosterStatusChange(
  oldMember: GuildMember,
  newMember: GuildMember
): Promise<void> {
  if (!oldMember.premiumSince || newMember.premiumSince) return;

  const record = getCustomRoleByUserId(newMember.id);
  if (!record || record.source !== 'booster') return;

  if (record.role_id) {
    const role =
      newMember.guild.roles.cache.get(record.role_id) ||
      (await newMember.guild.roles.fetch(record.role_id).catch(() => null));
    if (role) {
      await role.delete('Server Boost berakhir — Custom Role Booster dihapus otomatis').catch(() => {});
    }
  }

  deleteCustomRoleByUserId(newMember.id);

  try {
    await newMember.user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf47fff)
          .setTitle('💎 Masa Boost Berakhir — Custom Role Dihapus')
          .setDescription(
            `Terima kasih banyak sudah pernah mendukung **${newMember.guild.name}** dengan Server Boost! 💖\n\nKarena masa boost telah berakhir, Custom Role **${record.name}** telah dihapus otomatis. Jika kamu boost kembali di lain waktu, kamu bisa langsung membuat Custom Role baru lewat \`/mrole\`!`
          )
          .setFooter({ text: 'Tim Humas' })
          .setTimestamp(),
      ],
    });
  } catch {
    // Ignore if user DMs are closed
  }
}

