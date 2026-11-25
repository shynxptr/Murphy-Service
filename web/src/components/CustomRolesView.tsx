import { useEffect, useState, type FormEvent } from 'react';
import { Gift, Palette, Save, Trash2, X } from 'lucide-react';
import { apiFetch } from '../api';
import type {
  AuthUser,
  CustomRoleRecord,
  CustomRoleSettings,
  GuildMemberOption,
} from '../types';

interface Props {
  user: AuthUser;
}

export function CustomRolesView({ user }: Props) {
  const [roles, setRoles] = useState<CustomRoleRecord[]>([]);
  const [settings, setSettings] = useState<CustomRoleSettings | null>(null);
  const [savedMsg, setSavedMsg] = useState('');

  // Grant Modal
  const [showGrant, setShowGrant] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState<GuildMemberOption[]>([]);
  const [userId, setUserId] = useState('');
  const [username, setUsername] = useState('');
  const [roleName, setRoleName] = useState('');
  const [roleColor, setRoleColor] = useState('#6366F1');
  const [sideColor, setSideColor] = useState('');
  const [maxShares, setMaxShares] = useState(10);
  const [grantLoading, setGrantLoading] = useState(false);

  const isSuperAdmin = user.role === 'superadmin';

  async function load() {
    const res = await apiFetch<{ roles: CustomRoleRecord[]; settings: CustomRoleSettings }>(
      '/api/custom-roles'
    );
    setRoles(res.roles);
    setSettings(res.settings);
    setMaxShares(res.settings.defaultMaxShares);
  }

  useEffect(() => {
    void load();
  }, []);

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

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    await apiFetch('/api/custom-roles/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
    setSavedMsg('Pengaturan Custom Role (/mrole) berhasil disimpan!');
    setTimeout(() => setSavedMsg(''), 3000);
  }

  async function handleGrant(e: FormEvent) {
    e.preventDefault();
    if (!userId.trim()) return;
    setGrantLoading(true);
    try {
      await apiFetch('/api/custom-roles/grant', {
        method: 'POST',
        body: JSON.stringify({
          discord_user_id: userId.trim(),
          discord_username: username.trim() || userId.trim(),
          role_name: roleName.trim() || undefined,
          role_color: roleColor.trim() || undefined,
          side_color: sideColor.trim() || undefined,
          max_shares: maxShares,
          notify_dm: true,
        }),
      });
      setShowGrant(false);
      setUserId('');
      setUsername('');
      setRoleName('');
      setSideColor('');
      await load();
    } finally {
      setGrantLoading(false);
    }
  }

  async function handleRevoke(targetUserId: string, name: string) {
    if (!confirm(`Hapus & cabut Custom Role milik ${name}? Role di Discord juga akan dihapus.`)) {
      return;
    }
    await apiFetch(`/api/custom-roles/${targetUserId}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Palette className="w-5 h-5 text-pink-400" />
            Custom Role Booster & Benefit (/mrole)
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Otomatis aktif untuk <strong>Server Booster Discord</strong> (terhapus otomatis saat berhenti boost) dan penerima benefit dari Humas.
          </p>
        </div>

        <button
          onClick={() => {
            setShowGrant(true);
            void searchMembers('');
          }}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 text-white font-medium cursor-pointer"
        >
          <Gift className="w-3.5 h-3.5" />
          Grant Custom Role (Non-Booster)
        </button>
      </div>

      {/* Settings panel */}
      {settings && (
        <form
          onSubmit={handleSaveSettings}
          className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">Pengaturan `/mrole` & Prefix `!mrole`</h2>
            <div className="flex items-center gap-4 text-xs text-slate-200">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={!isSuperAdmin}
                  checked={settings.enabled}
                  onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                />
                Aktifkan Fitur
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={!isSuperAdmin}
                  checked={settings.allowHoist}
                  onChange={(e) => setSettings({ ...settings, allowHoist: e.target.checked })}
                />
                Izinkan Hoist
              </label>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-3 items-end">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Kuota Share Teman Default</label>
              <input
                type="number"
                min={0}
                max={50}
                disabled={!isSuperAdmin}
                value={settings.defaultMaxShares}
                onChange={(e) =>
                  setSettings({ ...settings, defaultMaxShares: Number(e.target.value) })
                }
                className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Anchor Role ID (Opsional — posisi role ditaruh di bawah role ini)
              </label>
              <input
                disabled={!isSuperAdmin}
                value={settings.anchorRoleId}
                onChange={(e) => setSettings({ ...settings, anchorRoleId: e.target.value })}
                placeholder="Kosongkan = tepat di bawah role tertinggi Bot"
                className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
              />
            </div>
            {isSuperAdmin && (
              <button
                type="submit"
                className="py-1.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                Simpan Pengaturan
              </button>
            )}
          </div>
          {savedMsg && <p className="text-xs text-emerald-400">{savedMsg}</p>}
        </form>
      )}

      {/* Active Roles Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950/70 text-slate-400 uppercase text-[11px] border-b border-slate-800">
            <tr>
              <th className="p-3">Pemilik</th>
              <th className="p-3">Sumber Akses</th>
              <th className="p-3">Custom Role</th>
              <th className="p-3">Warna</th>
              <th className="p-3">Share</th>
              {isSuperAdmin && <th className="p-3 text-right">Aksi</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {roles.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-500">
                  Belum ada Custom Role aktif. Booster dapat langsung mengetik <code>/mrole</code> atau <code>!mrole</code> di server!
                </td>
              </tr>
            )}
            {roles.map((r) => (
              <tr key={r.id} className="hover:bg-slate-800/40">
                <td className="p-3">
                  <div className="font-medium text-white">{r.discord_username || r.discord_user_id}</div>
                  <div className="text-[10px] font-mono text-slate-500">{r.discord_user_id}</div>
                </td>
                <td className="p-3">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      r.source === 'booster'
                        ? 'bg-pink-500/20 text-pink-300'
                        : 'bg-indigo-500/20 text-indigo-300'
                    }`}
                  >
                    {r.source === 'booster' ? '💎 Server Booster' : '🎁 Benefit Humas'}
                  </span>
                </td>
                <td className="p-3 text-slate-200 font-medium">
                  {r.role_id ? r.name : <span className="text-slate-500 italic">Belum dibuat user</span>}
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-white/20"
                      style={{ backgroundColor: r.color }}
                    />
                    <span className="font-mono text-[11px] text-slate-300">
                      {r.color} {r.side_color || ''}
                    </span>
                  </div>
                </td>
                <td className="p-3 text-slate-300">
                  {r.shared_with.length} / {r.max_shares}
                </td>
                {isSuperAdmin && (
                  <td className="p-3 text-right">
                    <button
                      onClick={() => void handleRevoke(r.discord_user_id, r.discord_username || r.discord_user_id)}
                      className="p-1.5 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 cursor-pointer"
                      title="Cabut & Hapus Role"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Grant Modal */}
      {showGrant && (
        <div className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4">
          <form
            onSubmit={handleGrant}
            className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">Grant Akses Custom Role (/mrole)</h3>
              <button type="button" onClick={() => setShowGrant(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Cari Member Server</label>
              <input
                value={memberQuery}
                onChange={(e) => void searchMembers(e.target.value)}
                placeholder="Ketik username..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
              />
              {memberResults.length > 0 && (
                <div className="mt-2 max-h-32 overflow-y-auto divide-y divide-slate-800 border border-slate-800 rounded-lg">
                  {memberResults.map((m) => (
                    <button
                      type="button"
                      key={m.id}
                      onClick={() => {
                        setUserId(m.id);
                        setUsername(m.username);
                      }}
                      className="w-full flex items-center gap-2 p-2 hover:bg-slate-800 text-left cursor-pointer"
                    >
                      <img src={m.avatar} alt="" className="w-6 h-6 rounded-full" />
                      <span className="text-xs text-white">{m.displayName}</span>
                      <span className="text-[11px] text-slate-400">@{m.username}</span>
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
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Kuota Share Teman</label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={maxShares}
                  onChange={(e) => setMaxShares(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400 block mb-1">
                  Langsung Buatkan Role? (Opsional — kosongkan jika ingin member buat sendiri lewat /mrole)
                </label>
                <input
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                  placeholder="Nama Role (opsional)"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Warna Utama (Hex)</label>
                <input
                  value={roleColor}
                  onChange={(e) => setRoleColor(e.target.value)}
                  placeholder="#6366F1"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Side Color Gradasi (Opsional)</label>
                <input
                  value={sideColor}
                  onChange={(e) => setSideColor(e.target.value)}
                  placeholder="#EC4899"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowGrant(false)}
                className="px-3 py-2 text-xs text-slate-300 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={grantLoading}
                className="px-4 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 text-white text-xs font-medium cursor-pointer"
              >
                {grantLoading ? 'Memproses...' : 'Berikan Akses & Kirim DM'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

