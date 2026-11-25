import { useEffect, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  Download,
  Lock,
  MessageSquare,
  Plus,
  Send,
  Trash2,
  Trophy,
  Unlock,
  X,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../api';
import type {
  AuthUser,
  GuildChannelOption,
  Tournament,
  TournamentMode,
  TournamentNotifSettings,
  TournamentRegistration,
} from '../types';

interface Props {
  user: AuthUser;
  onOpenChat: (discordUserId: string, username: string) => void;
}

export function TournamentsView({ user, onOpenChat }: Props) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [notifSettings, setNotifSettings] = useState<TournamentNotifSettings | null>(null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [selectedTrn, setSelectedTrn] = useState<Tournament | null>(null);
  const [regs, setRegs] = useState<TournamentRegistration[]>([]);
  const [regFilter, setRegFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  // Create Modal
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [game, setGame] = useState('Mobile Legends (MLBB)');
  const [mode, setMode] = useState<TournamentMode>('team');
  const [maxSlots, setMaxSlots] = useState(16);
  const [description, setDescription] = useState('');
  const [roleId, setRoleId] = useState('');
  const [postChannelId, setPostChannelId] = useState('');
  const [creating, setCreating] = useState(false);

  // Post Panel Modal
  const [postTargetTrn, setPostTargetTrn] = useState<Tournament | null>(null);
  const [repostChannelId, setRepostChannelId] = useState('');

  // Reject Reason Modal
  const [rejectTarget, setRejectTarget] = useState<TournamentRegistration | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  async function loadAll() {
    const [tRes, cRes] = await Promise.all([
      apiFetch<{ tournaments: Tournament[]; notifSettings: TournamentNotifSettings }>(
        '/api/tournaments'
      ),
      apiFetch<{ channels: GuildChannelOption[] }>('/api/channels').catch(() => ({ channels: [] })),
    ]);
    setTournaments(tRes.tournaments);
    setNotifSettings(tRes.notifSettings);
    setChannels(cRes.channels);
    if (selectedTrn) {
      const refreshed = tRes.tournaments.find((x) => x.id === selectedTrn.id) || null;
      setSelectedTrn(refreshed);
    }
  }

  async function loadRegs(trnId: number) {
    const res = await apiFetch<{ registrations: TournamentRegistration[] }>(
      `/api/tournaments/${trnId}/registrations`
    );
    setRegs(res.registrations);
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (selectedTrn) {
      void loadRegs(selectedTrn.id);
    }
  }, [selectedTrn?.id]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    try {
      await apiFetch('/api/tournaments', {
        method: 'POST',
        body: JSON.stringify({
          title,
          game,
          mode,
          max_slots: maxSlots,
          description,
          participant_role_id: roleId || null,
          post_channel_id: postChannelId || '',
        }),
      });
      setTitle('');
      setDescription('');
      setRoleId('');
      setShowCreate(false);
      await loadAll();
    } finally {
      setCreating(false);
    }
  }

  async function handlePostPanel(e: FormEvent) {
    e.preventDefault();
    if (!postTargetTrn || !repostChannelId) return;
    await apiFetch(`/api/tournaments/${postTargetTrn.id}/post`, {
      method: 'POST',
      body: JSON.stringify({ channel_id: repostChannelId }),
    });
    setPostTargetTrn(null);
    await loadAll();
  }

  async function handleToggle(t: Tournament) {
    await apiFetch(`/api/tournaments/${t.id}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ is_open: t.is_open === 0 }),
    });
    await loadAll();
  }

  async function handleDelete(t: Tournament) {
    if (!confirm(`Hapus turnamen "${t.title}" beserta seluruh data pendaftarnya?`)) return;
    await apiFetch(`/api/tournaments/${t.id}`, { method: 'DELETE' });
    if (selectedTrn?.id === t.id) setSelectedTrn(null);
    await loadAll();
  }

  async function handleApprove(reg: TournamentRegistration) {
    await apiFetch(`/api/tournaments/registrations/${reg.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'approved' }),
    });
    await loadAll();
    if (selectedTrn) await loadRegs(selectedTrn.id);
  }

  async function handleRejectSubmit(e: FormEvent) {
    e.preventDefault();
    if (!rejectTarget) return;
    await apiFetch(`/api/tournaments/registrations/${rejectTarget.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rejected', reject_reason: rejectReason }),
    });
    setRejectTarget(null);
    setRejectReason('');
    await loadAll();
    if (selectedTrn) await loadRegs(selectedTrn.id);
  }

  const filteredRegs = regs.filter((r) => (regFilter === 'all' ? true : r.status === regFilter));

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-400" />
            Pendaftaran Turnamen (Discord Modal)
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Post panel pendaftaran ke channel Discord. Atur notifikasi Approve via slash command{' '}
            <code>/turnamen-notif</code>.
          </p>
        </div>

        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          Buat Turnamen
        </button>
      </div>

      {/* Current /turnamen-notif summary */}
      {notifSettings && (
        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="text-slate-300 space-y-0.5">
            <div>
              <strong className="text-white">Notif Approve Aktif:</strong>{' '}
              DM Kapten: <span className="text-emerald-400">{notifSettings.sendDm ? 'ON' : 'OFF'}</span> •
              Channel Pengumuman:{' '}
              <span className="text-indigo-300 font-mono">
                {notifSettings.announceChannelId || 'Belum diatur'}
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              Ubah kapan saja langsung dari Discord dengan command <code>/turnamen-notif</code>.
            </div>
          </div>
        </div>
      )}

      {/* Tournaments List */}
      <div className="grid md:grid-cols-2 gap-4">
        {tournaments.length === 0 && (
          <div className="md:col-span-2 p-8 rounded-xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-500">
            Belum ada turnamen. Klik <strong>"Buat Turnamen"</strong> untuk membuat form pendaftaran MLBB, Valorant, dll!
          </div>
        )}

        {tournaments.map((t) => {
          const active = selectedTrn?.id === t.id;
          return (
            <div
              key={t.id}
              className={`p-4 rounded-xl bg-slate-900 border space-y-3 transition ${
                active ? 'border-amber-500/60' : 'border-slate-800'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-white text-sm">{t.title}</h3>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    🎮 {t.game} • {t.mode === 'team' ? 'Mode Tim' : 'Mode Solo'}
                  </div>
                </div>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${
                    t.is_open ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {t.is_open ? 'Dibuka' : 'Ditutup'}
                </span>
              </div>

              <div className="flex items-center gap-3 text-xs text-slate-300">
                <span>
                  Slot: <strong className="text-white">{t.approved_count || 0} / {t.max_slots}</strong>
                </span>
                <span>
                  Pending: <strong className="text-amber-400">{t.pending_count || 0}</strong>
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-800 text-xs">
                <button
                  onClick={() => setSelectedTrn(t)}
                  className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium cursor-pointer"
                >
                  Kelola Peserta
                </button>
                <button
                  onClick={() => {
                    setPostTargetTrn(t);
                    setRepostChannelId(t.channel_id || channels[0]?.id || '');
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
                >
                  <Send className="w-3 h-3" /> Post Panel
                </button>
                <button
                  onClick={() => void handleToggle(t)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
                >
                  {t.is_open ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  {t.is_open ? 'Tutup' : 'Buka'}
                </button>
                <a
                  href={`/api/tournaments/${t.id}/export/csv`}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1"
                >
                  <Download className="w-3 h-3" /> CSV
                </a>
                {user.role === 'superadmin' && (
                  <button
                    onClick={() => void handleDelete(t)}
                    className="ml-auto p-1.5 rounded-lg hover:bg-red-500/20 text-slate-500 hover:text-red-400 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Registrations Panel */}
      {selectedTrn && (
        <div className="p-4 sm:p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-white">
                Daftar Peserta — {selectedTrn.title}
              </h2>
              <p className="text-xs text-slate-400">
                Disetujui: {selectedTrn.approved_count || 0}/{selectedTrn.max_slots} • Menunggu:{' '}
                {selectedTrn.pending_count || 0}
              </p>
            </div>

            <div className="flex gap-1 bg-slate-950 p-1 rounded-lg text-xs">
              {(['all', 'pending', 'approved', 'rejected'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setRegFilter(f)}
                  className={`px-2.5 py-1 rounded-md capitalize cursor-pointer ${
                    regFilter === f ? 'bg-slate-800 text-white font-medium' : 'text-slate-400'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {filteredRegs.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">
              Belum ada data pendaftar pada filter ini.
            </p>
          ) : (
            <div className="space-y-3">
              {filteredRegs.map((r) => (
                <div
                  key={r.id}
                  className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-bold text-white">{r.team_name}</span>
                      <span className="ml-2 text-slate-400">
                        Perwakilan: @{r.captain_username} ({r.representative_contact || '-'})
                      </span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                        r.status === 'approved'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : r.status === 'rejected'
                          ? 'bg-red-500/20 text-red-300'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 whitespace-pre-wrap text-slate-200 font-mono text-[11px]">
                    {r.roster_text}
                  </div>

                  {(r.substitutes || r.notes) && (
                    <div className="text-slate-400 space-y-0.5">
                      {r.substitutes && <div>Cadangan / Rank: {r.substitutes}</div>}
                      {r.notes && <div>Catatan: {r.notes}</div>}
                    </div>
                  )}

                  {r.reject_reason && (
                    <div className="text-red-300">Alasan Ditolak: {r.reject_reason}</div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80">
                    {r.status !== 'approved' && (
                      <button
                        onClick={() => void handleApprove(r)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium flex items-center gap-1 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                      </button>
                    )}
                    {r.status !== 'rejected' && (
                      <button
                        onClick={() => setRejectTarget(r)}
                        className="px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 font-medium flex items-center gap-1 cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Reject
                      </button>
                    )}
                    <button
                      onClick={() => onOpenChat(r.captain_discord_id, r.captain_username)}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 flex items-center gap-1 cursor-pointer"
                    >
                      <MessageSquare className="w-3.5 h-3.5" /> Chat Kapten
                    </button>
                    {r.reviewed_by && (
                      <span className="ml-auto text-[11px] text-slate-500">
                        Dicek oleh {r.reviewed_by}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Tournament Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreate}
            className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3.5 max-h-[90dvh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">Buat Pendaftaran Turnamen Baru</h3>
              <button type="button" onClick={() => setShowCreate(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Nama Turnamen *</label>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Contoh: Murphy MLBB Cup Season 1"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Game</label>
                <input
                  value={game}
                  onChange={(e) => setGame(e.target.value)}
                  placeholder="MLBB / Valorant / PUBG"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Mode Pendaftaran</label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as TournamentMode)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                >
                  <option value="team">Tim / Squad (5v5 dll)</option>
                  <option value="solo">Solo / Individu</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Kuota Slot</label>
                <input
                  type="number"
                  min={2}
                  max={512}
                  value={maxSlots}
                  onChange={(e) => setMaxSlots(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Role Peserta ID (Opsional)</label>
                <input
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                  placeholder="Auto-assign saat Approve"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Deskripsi / Info Jadwal & Hadiah</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Jadwal tanding, prize pool, syarat singkat..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Langsung Post Panel Pendaftaran ke Channel (Opsional)
              </label>
              <select
                value={postChannelId}
                onChange={(e) => setPostChannelId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
              >
                <option value="">— Simpan dulu, post nanti —</option>
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    #{ch.name} {ch.parentName ? `(${ch.parentName})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-3 py-2 text-xs text-slate-300 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={creating}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium cursor-pointer"
              >
                {creating ? 'Menyimpan...' : 'Buat Turnamen'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Post Panel Modal */}
      {postTargetTrn && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handlePostPanel}
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white text-sm">
                Post Panel: {postTargetTrn.title}
              </h3>
              <button type="button" onClick={() => setPostTargetTrn(null)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <select
              required
              value={repostChannelId}
              onChange={(e) => setRepostChannelId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
            >
              <option value="">Pilih channel Discord...</option>
              {channels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  #{ch.name}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPostTargetTrn(null)}
                className="px-3 py-2 text-xs text-slate-300 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
              >
                Kirim Panel ke Channel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Reject Reason Modal */}
      {rejectTarget && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleRejectSubmit}
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white text-sm">
                Tolak Pendaftaran: {rejectTarget.team_name}
              </h3>
              <button type="button" onClick={() => setRejectTarget(null)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <textarea
              rows={3}
              required
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Tulis alasan penolakan (akan dikirim ke perwakilan tim via DM)..."
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="px-3 py-2 text-xs text-slate-300 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium cursor-pointer"
              >
                Tolak & Kirim Notif
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
