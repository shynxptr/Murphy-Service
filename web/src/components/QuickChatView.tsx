import { useEffect, useState, type FormEvent } from 'react';
import {
  BellRing,
  CheckCircle2,
  MessageSquare,
  Plus,
  Send,
  Trash2,
  UserPlus,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { apiFetch } from '../api';
import type { GuildMemberOption, QuickContact, QuickContactGroup } from '../types';

interface Props {
  onOpenChat: (discordUserId: string, username: string) => void;
}

const GROUP_META: Record<QuickContactGroup, { label: string; badge: string }> = {
  staff: { label: 'Staff', badge: 'bg-indigo-500/20 text-indigo-300' },
  benefit: { label: 'Benefit / Role', badge: 'bg-amber-500/20 text-amber-300' },
  vip: { label: 'VIP / Donatur', badge: 'bg-emerald-500/20 text-emerald-300' },
  other: { label: 'Lainnya', badge: 'bg-slate-700 text-slate-300' },
};

const REMINDER_PRESETS = [
  {
    name: 'Rapat Staff',
    title: '🔔 Reminder Rapat Tim Staff',
    message:
      'Halo rekan Staff! Mengingatkan bahwa rapat/koordinasi kita akan segera dimulai. Mohon bersiap dan hadir tepat waktu ya. Terima kasih!',
  },
  {
    name: 'Tugas / Deadline',
    title: '⏰ Reminder Progres & Deadline',
    message:
      'Halo! Sekadar mengingatkan terkait tugas/progres yang sedang berjalan. Jika ada kendala atau butuh bantuan tim Humas, silakan langsung balas pesan ini ya.',
  },
  {
    name: 'Klaim Benefit',
    title: '✨ Reminder Pengambilan Benefit',
    message:
      'Halo! Mengingatkan bahwa benefit kamu (Custom Role / Reward) belum diklaim. Silakan balas pesan ini untuk proses pengambilan sebelum batas waktu berakhir ya!',
  },
];

export function QuickChatView({ onOpenChat }: Props) {
  const [contacts, setContacts] = useState<QuickContact[]>([]);
  const [groupFilter, setGroupFilter] = useState<'all' | QuickContactGroup>('all');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Add Member Modal
  const [showAdd, setShowAdd] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState<GuildMemberOption[]>([]);
  const [discordId, setDiscordId] = useState('');
  const [discordUsername, setDiscordUsername] = useState('');
  const [label, setLabel] = useState('');
  const [groupTag, setGroupTag] = useState<QuickContactGroup>('staff');
  const [notes, setNotes] = useState('');

  // Quick Reminder Modal
  const [showRemind, setShowRemind] = useState(false);
  const [remindTargetIds, setRemindTargetIds] = useState<number[]>([]);
  const [remindTitle, setRemindTitle] = useState('🔔 Quick Reminder — Tim Humas');
  const [remindMessage, setRemindMessage] = useState('');
  const [remindLoading, setRemindLoading] = useState(false);
  const [remindResult, setRemindResult] = useState<{
    sentCount: number;
    failedCount: number;
    results: Array<{ id: number; label: string; ok: boolean; error?: string }>;
  } | null>(null);

  async function loadContacts() {
    const res = await apiFetch<{ contacts: QuickContact[] }>('/api/quick-contacts');
    setContacts(res.contacts);
  }

  useEffect(() => {
    void loadContacts();
  }, []);

  const filtered = contacts.filter((c) =>
    groupFilter === 'all' ? true : c.group_tag === groupFilter
  );

  async function searchMembers(q: string) {
    setMemberQuery(q);
    try {
      const res = await apiFetch<{ members: GuildMemberOption[] }>(
        `/api/conversations/members/search?q=${encodeURIComponent(q)}`
      );
      setMemberResults(res.members);
    } catch {
      setMemberResults([]);
    }
  }

  async function handleSaveContact(e: FormEvent) {
    e.preventDefault();
    if (!discordId.trim()) return;
    await apiFetch('/api/quick-contacts', {
      method: 'POST',
      body: JSON.stringify({
        discord_user_id: discordId.trim(),
        discord_username: discordUsername.trim() || discordId.trim(),
        label: label.trim() || discordUsername.trim() || discordId.trim(),
        group_tag: groupTag,
        notes: notes.trim(),
      }),
    });
    setDiscordId('');
    setDiscordUsername('');
    setLabel('');
    setNotes('');
    setShowAdd(false);
    await loadContacts();
  }

  async function handleDelete(id: number) {
    if (!confirm('Hapus member ini dari daftar Quick Chat?')) return;
    await apiFetch(`/api/quick-contacts/${id}`, { method: 'DELETE' });
    setSelectedIds((prev) => prev.filter((x) => x !== id));
    await loadContacts();
  }

  function openReminderFor(ids: number[]) {
    if (ids.length === 0) return;
    setRemindTargetIds(ids);
    setRemindResult(null);
    setShowRemind(true);
  }

  async function handleSendReminder(e: FormEvent) {
    e.preventDefault();
    if (remindTargetIds.length === 0 || !remindMessage.trim()) return;
    setRemindLoading(true);
    setRemindResult(null);
    try {
      const res = await apiFetch<{
        sentCount: number;
        failedCount: number;
        results: Array<{ id: number; label: string; ok: boolean; error?: string }>;
      }>('/api/quick-contacts/remind', {
        method: 'POST',
        body: JSON.stringify({
          contact_ids: remindTargetIds,
          title: remindTitle,
          message: remindMessage,
          use_embed: true,
        }),
      });
      setRemindResult(res);
    } finally {
      setRemindLoading(false);
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function selectAllStaff() {
    setSelectedIds(contacts.filter((c) => c.group_tag === 'staff').map((c) => c.id));
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-400" />
            Quick Chat & Staff Reminder
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Simpan daftar Staff atau Member penting untuk 1-klik buka roomchat atau kirim quick reminder via Bot.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => openReminderFor(selectedIds)}
            disabled={selectedIds.length === 0}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-medium cursor-pointer"
          >
            <BellRing className="w-3.5 h-3.5" />
            Kirim Quick Reminder ({selectedIds.length})
          </button>

          <button
            onClick={() => {
              setShowAdd(true);
              void searchMembers('');
            }}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Tambah Member
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setGroupFilter('all')}
          className={`text-xs px-3 py-1 rounded-full cursor-pointer ${
            groupFilter === 'all'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          Semua ({contacts.length})
        </button>
        {(Object.keys(GROUP_META) as QuickContactGroup[]).map((g) => (
          <button
            key={g}
            onClick={() => setGroupFilter(g)}
            className={`text-xs px-3 py-1 rounded-full cursor-pointer ${
              groupFilter === g
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            {GROUP_META[g].label} ({contacts.filter((c) => c.group_tag === g).length})
          </button>
        ))}

        <button
          onClick={selectAllStaff}
          className="ml-auto text-xs text-amber-400 hover:underline cursor-pointer"
        >
          Pilih Semua Staff ({contacts.filter((c) => c.group_tag === 'staff').length})
        </button>
      </div>

      {/* Contact Cards */}
      {filtered.length === 0 ? (
        <div className="p-10 rounded-xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-500">
          Belum ada member di daftar Quick Chat. Klik <strong>"Tambah Member"</strong> untuk menambahkan staff atau member penting.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((c) => {
            const meta = GROUP_META[c.group_tag] || GROUP_META.other;
            const checked = selectedIds.includes(c.id);
            return (
              <div
                key={c.id}
                className={`p-4 rounded-xl bg-slate-900 border transition flex flex-col justify-between gap-3 ${
                  checked ? 'border-amber-500/60 bg-amber-500/5' : 'border-slate-800'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <label className="flex items-start gap-2.5 cursor-pointer min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelect(c.id)}
                      className="mt-1 rounded border-slate-700"
                    />
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-white truncate">{c.label}</div>
                      <div className="text-[11px] text-slate-400 truncate">
                        @{c.discord_username}
                      </div>
                      <div className="text-[10px] font-mono text-slate-500">{c.discord_user_id}</div>
                    </div>
                  </label>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${meta.badge}`}>
                    {meta.label}
                  </span>
                </div>

                {c.notes && (
                  <p className="text-xs text-slate-400 bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
                    {c.notes}
                  </p>
                )}

                <div className="flex items-center gap-1.5 pt-2 border-t border-slate-800">
                  <button
                    onClick={() => onOpenChat(c.discord_user_id, c.discord_username)}
                    className="flex-1 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-medium flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Chat
                  </button>
                  <button
                    onClick={() => openReminderFor([c.id])}
                    className="flex-1 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs font-medium flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <BellRing className="w-3.5 h-3.5" />
                    Remind
                  </button>
                  <button
                    onClick={() => void handleDelete(c.id)}
                    title="Hapus"
                    className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-500 hover:text-red-400 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Member Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveContact}
            className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-400" />
                Tambah Member ke Quick Chat
              </h3>
              <button type="button" onClick={() => setShowAdd(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Cari Member dari Server Discord (Opsional)
              </label>
              <input
                value={memberQuery}
                onChange={(e) => void searchMembers(e.target.value)}
                placeholder="Ketik username member..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
              />
              {memberResults.length > 0 && (
                <div className="mt-2 max-h-36 overflow-y-auto divide-y divide-slate-800 border border-slate-800 rounded-lg">
                  {memberResults.map((m) => (
                    <button
                      type="button"
                      key={m.id}
                      onClick={() => {
                        setDiscordId(m.id);
                        setDiscordUsername(m.username);
                        if (!label) setLabel(m.displayName);
                      }}
                      className="w-full flex items-center gap-2.5 p-2 hover:bg-slate-800 text-left cursor-pointer"
                    >
                      <img src={m.avatar} alt="" className="w-7 h-7 rounded-full" />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-white truncate">
                          {m.displayName}
                        </div>
                        <div className="text-[11px] text-slate-400">@{m.username}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Discord User ID *</label>
                <input
                  required
                  value={discordId}
                  onChange={(e) => setDiscordId(e.target.value)}
                  placeholder="123456789012345678"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Username Discord</label>
                <input
                  value={discordUsername}
                  onChange={(e) => setDiscordUsername(e.target.value)}
                  placeholder="username"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Nama Panggilan / Jabatan</label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Misal: Budi (Divisi Event)"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Kelompok</label>
                <select
                  value={groupTag}
                  onChange={(e) => setGroupTag(e.target.value as QuickContactGroup)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                >
                  <option value="staff">Staff</option>
                  <option value="benefit">Benefit / Custom Role</option>
                  <option value="vip">VIP / Donatur</option>
                  <option value="other">Lainnya</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400 block mb-1">Catatan Singkat</label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Misal: PIC desain poster / perlu reminder setiap Jumat"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="px-3 py-2 text-xs text-slate-300 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
              >
                Simpan ke Quick Chat
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Quick Reminder Modal */}
      {showRemind && (
        <div className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4">
          <form
            onSubmit={handleSendReminder}
            className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <BellRing className="w-4 h-4 text-amber-400" />
                Kirim Quick Reminder ({remindTargetIds.length} orang)
              </h3>
              <button type="button" onClick={() => setShowRemind(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            {/* Preset chips */}
            <div className="flex flex-wrap gap-1.5">
              {REMINDER_PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => {
                    setRemindTitle(p.title);
                    setRemindMessage(p.message);
                  }}
                  className="text-[11px] px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                >
                  ⚡ {p.name}
                </button>
              ))}
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Judul Reminder</label>
              <input
                value={remindTitle}
                onChange={(e) => setRemindTitle(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Isi Pesan Reminder *</label>
              <textarea
                rows={4}
                required
                value={remindMessage}
                onChange={(e) => setRemindMessage(e.target.value)}
                placeholder="Ketik pesan pengingat yang akan dikirim via DM Bot..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
              />
            </div>

            {remindResult && (
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
                <div className="text-slate-200 font-medium">
                  Hasil: <span className="text-emerald-400">{remindResult.sentCount} terkirim</span> •{' '}
                  <span className="text-red-400">{remindResult.failedCount} gagal</span>
                </div>
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {remindResult.results.map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-300">{r.label}</span>
                      {r.ok ? (
                        <span className="text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Terkirim
                        </span>
                      ) : (
                        <span className="text-red-400 flex items-center gap-1">
                          <XCircle className="w-3 h-3" /> {r.error}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRemind(false)}
                className="px-3 py-2 text-xs text-slate-300 cursor-pointer"
              >
                Tutup
              </button>
              <button
                type="submit"
                disabled={remindLoading}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                {remindLoading ? 'Mengirim...' : 'Kirim Reminder Sekarang'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

