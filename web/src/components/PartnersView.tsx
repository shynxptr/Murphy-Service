import { useEffect, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Megaphone,
  MessageSquare,
  Plus,
  RefreshCw,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { apiFetch, connectSocket } from '../api';
import type { AuthUser, Partner } from '../types';

interface Props {
  user: AuthUser;
  onOpenChat: (discordUserId: string, username: string) => void;
}

export function PartnersView({ user, onOpenChat }: Props) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [tagFilter, setTagFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [checkingId, setCheckingId] = useState<number | null>(null);

  // Add/Edit Modal
  const [editing, setEditing] = useState<Partial<Partner> | null>(null);
  const [tagsInput, setTagsInput] = useState('');

  // Broadcast Modal
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [bcTitle, setBcTitle] = useState('');
  const [bcContent, setBcContent] = useState('');
  const [bcReceipts, setBcReceipts] = useState(true);
  const [bcProgress, setBcProgress] = useState<{
    total: number;
    sent: number;
    failed: number;
    done: boolean;
    currentPartner?: string;
  } | null>(null);

  async function loadPartners() {
    const data = await apiFetch<{ partners: Partner[] }>('/api/partners');
    setPartners(data.partners);
  }

  useEffect(() => {
    void loadPartners();
    const socket = connectSocket();
    const onProgress = (payload: {
      total: number;
      sent: number;
      failed: number;
      done: boolean;
      currentPartner?: string;
    }) => {
      setBcProgress(payload);
    };
    socket.on('broadcast:progress', onProgress);
    return () => {
      socket.off('broadcast:progress', onProgress);
    };
  }, []);

  const allTags = Array.from(new Set(partners.flatMap((p) => p.tags))).sort();
  const filtered = partners.filter((p) =>
    tagFilter ? p.tags.includes(tagFilter) : true
  );

  function openNewModal() {
    setEditing({
      server_name: '',
      pic_discord_id: '',
      pic_username: '',
      backup_pic_discord_id: '',
      backup_pic_name: '',
      invite_link: '',
      status: 'active',
      collaboration_history: '',
      notes: '',
    });
    setTagsInput('');
  }

  function openEditModal(p: Partner) {
    setEditing(p);
    setTagsInput(p.tags.join(', '));
  }

  async function handleSavePartner(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const payload = {
      ...editing,
      tags: tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };
    if (editing.id) {
      await apiFetch(`/api/partners/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    } else {
      await apiFetch('/api/partners', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }
    setEditing(null);
    await loadPartners();
  }

  async function handleCheckInvite(id: number) {
    setCheckingId(id);
    try {
      await apiFetch(`/api/partners/${id}/check-invite`, { method: 'POST' });
      await loadPartners();
    } finally {
      setCheckingId(null);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Hapus partner ini dari database?')) return;
    await apiFetch(`/api/partners/${id}`, { method: 'DELETE' });
    await loadPartners();
  }

  async function handleSendBroadcast(e: FormEvent) {
    e.preventDefault();
    if (selectedIds.length === 0 || !bcContent.trim()) return;
    setBcProgress({ total: selectedIds.length, sent: 0, failed: 0, done: false });
    await apiFetch('/api/partners/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        partner_ids: selectedIds,
        title: bcTitle,
        content: bcContent,
        include_receipt_buttons: bcReceipts,
      }),
    });
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function selectAllFiltered() {
    const activeIds = filtered.filter((p) => p.status === 'active').map((p) => p.id);
    setSelectedIds(activeIds);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Manajemen Partnership (CRM)</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Kelola database partner, PIC cadangan, riwayat kolaborasi, cek invite, dan broadcast tersegmentasi.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/api/partners/export/csv"
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </a>

          {user.role === 'superadmin' && (
            <button
              onClick={() => {
                if (selectedIds.length === 0) selectAllFiltered();
                setBcProgress(null);
                setShowBroadcast(true);
              }}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium cursor-pointer"
            >
              <Megaphone className="w-3.5 h-3.5" />
              Broadcast ({selectedIds.length})
            </button>
          )}

          <button
            onClick={openNewModal}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Tambah Partner
          </button>
        </div>
      </div>

      {/* Tag filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setTagFilter('')}
          className={`text-xs px-3 py-1 rounded-full cursor-pointer ${
            tagFilter === ''
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          Semua ({partners.length})
        </button>
        {allTags.map((tag) => (
          <button
            key={tag}
            onClick={() => setTagFilter(tag)}
            className={`text-xs px-3 py-1 rounded-full cursor-pointer ${
              tagFilter === tag
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            #{tag}
          </button>
        ))}
        <button
          onClick={selectAllFiltered}
          className="ml-auto text-xs text-indigo-400 hover:underline cursor-pointer"
        >
          Pilih Semua Aktif ({filtered.filter((p) => p.status === 'active').length})
        </button>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950/70 text-slate-400 uppercase text-[11px] border-b border-slate-800">
            <tr>
              <th className="p-3 w-8"></th>
              <th className="p-3">Server Partner</th>
              <th className="p-3">PIC & Cadangan</th>
              <th className="p-3">Tag</th>
              <th className="p-3">Invite</th>
              <th className="p-3">Status / Strike</th>
              <th className="p-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">
                  Belum ada partner terdaftar.
                </td>
              </tr>
            )}
            {filtered.map((p) => (
              <tr key={p.id} className="hover:bg-slate-800/40">
                <td className="p-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(p.id)}
                    onChange={() => toggleSelect(p.id)}
                    className="rounded border-slate-700"
                  />
                </td>
                <td className="p-3">
                  <div className="font-semibold text-white">{p.server_name}</div>
                  {p.collaboration_history && (
                    <div className="text-[11px] text-slate-400 truncate max-w-xs">
                      {p.collaboration_history}
                    </div>
                  )}
                </td>
                <td className="p-3">
                  <div className="text-slate-200">{p.pic_username}</div>
                  <div className="text-[10px] font-mono text-slate-500">{p.pic_discord_id}</div>
                  {p.backup_pic_name && (
                    <div className="text-[11px] text-amber-300/80 mt-0.5">
                      Cadangan: {p.backup_pic_name}
                    </div>
                  )}
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    {p.tags.map((t) => (
                      <span
                        key={t}
                        className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="p-3">
                  {p.invite_link ? (
                    <div className="flex items-center gap-1.5">
                      {p.invite_status === 'valid' && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                      {p.invite_status === 'invalid' && (
                        <XCircle className="w-3.5 h-3.5 text-red-400" />
                      )}
                      <a
                        href={p.invite_link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-400 hover:underline flex items-center gap-0.5"
                      >
                        Link <ExternalLink className="w-3 h-3" />
                      </a>
                      <button
                        onClick={() => void handleCheckInvite(p.id)}
                        disabled={checkingId === p.id}
                        title="Cek validitas invite link"
                        className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${checkingId === p.id ? 'animate-spin' : ''}`}
                        />
                      </button>
                    </div>
                  ) : (
                    <span className="text-slate-600">-</span>
                  )}
                </td>
                <td className="p-3">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      p.status === 'active'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : p.status === 'blacklisted'
                        ? 'bg-red-500/20 text-red-300'
                        : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    {p.status}
                  </span>
                  {p.strikes > 0 && (
                    <span className="ml-1.5 text-[11px] text-red-400 font-semibold">
                      ({p.strikes} strike)
                    </span>
                  )}
                </td>
                <td className="p-3 text-right">
                  <div className="inline-flex items-center gap-1.5">
                    <button
                      onClick={() => onOpenChat(p.pic_discord_id, p.pic_username)}
                      className="px-2 py-1 rounded bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 flex items-center gap-1 cursor-pointer"
                    >
                      <MessageSquare className="w-3 h-3" /> Chat
                    </button>
                    <button
                      onClick={() => openEditModal(p)}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                    >
                      Edit
                    </button>
                    {user.role === 'superadmin' && (
                      <button
                        onClick={() => void handleDelete(p.id)}
                        className="p-1 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Partner Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4">
          <form
            onSubmit={handleSavePartner}
            className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">
                {editing.id ? 'Edit Data Partner' : 'Tambah Partner Baru'}
              </h3>
              <button type="button" onClick={() => setEditing(null)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-slate-400 block mb-1">Nama Server / Komunitas *</label>
                <input
                  required
                  value={editing.server_name || ''}
                  onChange={(e) => setEditing({ ...editing, server_name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Discord ID PIC Utama *</label>
                <input
                  required
                  value={editing.pic_discord_id || ''}
                  onChange={(e) => setEditing({ ...editing, pic_discord_id: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Username PIC Utama</label>
                <input
                  value={editing.pic_username || ''}
                  onChange={(e) => setEditing({ ...editing, pic_username: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Discord ID PIC Cadangan</label>
                <input
                  value={editing.backup_pic_discord_id || ''}
                  onChange={(e) =>
                    setEditing({ ...editing, backup_pic_discord_id: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Nama PIC Cadangan</label>
                <input
                  value={editing.backup_pic_name || ''}
                  onChange={(e) => setEditing({ ...editing, backup_pic_name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Link Invite Discord</label>
                <input
                  value={editing.invite_link || ''}
                  onChange={(e) => setEditing({ ...editing, invite_link: e.target.value })}
                  placeholder="https://discord.gg/..."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Status</label>
                <select
                  value={editing.status || 'active'}
                  onChange={(e) =>
                    setEditing({ ...editing, status: e.target.value as Partner['status'] })
                  }
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
                >
                  <option value="active">Aktif</option>
                  <option value="inactive">Nonaktif</option>
                  <option value="blacklisted">Blacklisted / Watchlist</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400 block mb-1">
                  Tag Kategori (pisahkan dengan koma, misal: gaming, kampus, media)
                </label>
                <input
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400 block mb-1">
                  Riwayat Relasi & Kolaborasi (untuk handover pengurus)
                </label>
                <textarea
                  rows={3}
                  value={editing.collaboration_history || ''}
                  onChange={(e) =>
                    setEditing({ ...editing, collaboration_history: e.target.value })
                  }
                  placeholder="Contoh: Media partner Event X (Maret 2026), sangat responsif..."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
              >
                Simpan Partner
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Broadcast Modal */}
      {showBroadcast && (
        <div className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4">
          <form
            onSubmit={handleSendBroadcast}
            className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">
                Broadcast ke {selectedIds.length} Partner Terpilih
              </h3>
              <button type="button" onClick={() => setShowBroadcast(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Judul Broadcast</label>
              <input
                value={bcTitle}
                onChange={(e) => setBcTitle(e.target.value)}
                placeholder="📢 Informasi Event / Kolaborasi"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Isi Pesan *</label>
              <textarea
                rows={5}
                required
                value={bcContent}
                onChange={(e) => setBcContent(e.target.value)}
                placeholder="Tulis informasi yang akan dikirim berjeda ke PIC partner..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={bcReceipts}
                onChange={(e) => setBcReceipts(e.target.checked)}
              />
              Sertakan tombol konfirmasi baca ("✅ Siap Share" / "❌ Berhalangan")
            </label>

            {bcProgress && (
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1.5">
                <div className="flex justify-between text-slate-300">
                  <span>
                    {bcProgress.done
                      ? 'Broadcast selesai!'
                      : `Mengirim ke: ${bcProgress.currentPartner || '...'}`}
                  </span>
                  <span>
                    {bcProgress.sent + bcProgress.failed} / {bcProgress.total}
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{
                      width: `${Math.round(
                        ((bcProgress.sent + bcProgress.failed) / Math.max(1, bcProgress.total)) * 100
                      )}%`,
                    }}
                  />
                </div>
                <div className="text-slate-400">
                  Terkirim: <strong className="text-emerald-400">{bcProgress.sent}</strong> • Gagal:{' '}
                  <strong className="text-red-400">{bcProgress.failed}</strong>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowBroadcast(false)}
                className="px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Tutup
              </button>
              <button
                type="submit"
                disabled={selectedIds.length === 0 || (bcProgress !== null && !bcProgress.done)}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
              >
                Mulai Kirim Broadcast
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

