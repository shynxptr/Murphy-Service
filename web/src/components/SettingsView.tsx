import { useEffect, useState, type FormEvent } from 'react';
import { Clock, FileText, Package, Plus, Save, Trash2 } from 'lucide-react';
import { apiFetch } from '../api';
import type {
  AuthUser,
  ConversationCategory,
  MediaKitSettings,
  MessageTemplate,
  OfficeHoursSettings,
} from '../types';

interface Props {
  user: AuthUser;
}

const DAYS = [
  { id: 0, label: 'Min' },
  { id: 1, label: 'Sen' },
  { id: 2, label: 'Sel' },
  { id: 3, label: 'Rab' },
  { id: 4, label: 'Kam' },
  { id: 5, label: 'Jum' },
  { id: 6, label: 'Sab' },
];

export function SettingsView({ user }: Props) {
  const [officeHours, setOfficeHours] = useState<OfficeHoursSettings | null>(null);
  const [mediaKit, setMediaKit] = useState<MediaKitSettings | null>(null);
  const [savedMsg, setSavedMsg] = useState('');
  const [kitSavedMsg, setKitSavedMsg] = useState('');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);

  const [tplName, setTplName] = useState('');
  const [tplCat, setTplCat] = useState<ConversationCategory>('general');
  const [tplContent, setTplContent] = useState('');

  const isSuperAdmin = user.role === 'superadmin';

  async function load() {
    const [oh, mk, t] = await Promise.all([
      apiFetch<{ officeHours: OfficeHoursSettings }>('/api/community/settings/office-hours'),
      apiFetch<{ mediaKit: MediaKitSettings }>('/api/community/settings/media-kit'),
      apiFetch<{ templates: MessageTemplate[] }>('/api/templates'),
    ]);
    setOfficeHours(oh.officeHours);
    setMediaKit(mk.mediaKit);
    setTemplates(t.templates);
  }

  async function handleSaveMediaKit(e: FormEvent) {
    e.preventDefault();
    if (!mediaKit) return;
    await apiFetch('/api/community/settings/media-kit', {
      method: 'PUT',
      body: JSON.stringify(mediaKit),
    });
    setKitSavedMsg('Paket Media Kit berhasil disimpan!');
    setTimeout(() => setKitSavedMsg(''), 3000);
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSaveOfficeHours(e: FormEvent) {
    e.preventDefault();
    if (!officeHours) return;
    await apiFetch('/api/community/settings/office-hours', {
      method: 'PUT',
      body: JSON.stringify(officeHours),
    });
    setSavedMsg('Pengaturan jam operasional berhasil disimpan!');
    setTimeout(() => setSavedMsg(''), 3000);
  }

  async function handleCreateTemplate(e: FormEvent) {
    e.preventDefault();
    if (!tplName.trim() || !tplContent.trim()) return;
    await apiFetch('/api/templates', {
      method: 'POST',
      body: JSON.stringify({ name: tplName, category: tplCat, content: tplContent }),
    });
    setTplName('');
    setTplContent('');
    await load();
  }

  async function handleDeleteTemplate(id: number) {
    await apiFetch(`/api/templates/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Office Hours */}
      {officeHours && (
        <form
          onSubmit={handleSaveOfficeHours}
          className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-400" />
                Auto-Reply Jam Operasional (Office Hours)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Jika diaktifkan, bot otomatis membalas DM yang masuk di luar jam operasional tim Humas.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                disabled={!isSuperAdmin}
                checked={officeHours.enabled}
                onChange={(e) =>
                  setOfficeHours({ ...officeHours, enabled: e.target.checked })
                }
              />
              Aktifkan Auto-Reply
            </label>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Jam Buka (0–23)</label>
              <input
                type="number"
                min={0}
                max={23}
                disabled={!isSuperAdmin}
                value={officeHours.startHour}
                onChange={(e) =>
                  setOfficeHours({ ...officeHours, startHour: Number(e.target.value) })
                }
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Jam Tutup (0–23)</label>
              <input
                type="number"
                min={0}
                max={23}
                disabled={!isSuperAdmin}
                value={officeHours.endHour}
                onChange={(e) =>
                  setOfficeHours({ ...officeHours, endHour: Number(e.target.value) })
                }
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Zona Waktu</label>
              <input
                disabled={!isSuperAdmin}
                value={officeHours.timezone}
                onChange={(e) =>
                  setOfficeHours({ ...officeHours, timezone: e.target.value })
                }
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Hari Operasional Aktif</label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => {
                const active = officeHours.activeDays.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={!isSuperAdmin}
                    onClick={() => {
                      const next = active
                        ? officeHours.activeDays.filter((x) => x !== d.id)
                        : [...officeHours.activeDays, d.id];
                      setOfficeHours({ ...officeHours, activeDays: next });
                    }}
                    className={`px-3 py-1 rounded-lg text-xs cursor-pointer ${
                      active
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-950 border border-slate-800 text-slate-400'
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">Pesan Auto-Reply</label>
            <textarea
              rows={3}
              disabled={!isSuperAdmin}
              value={officeHours.awayMessage}
              onChange={(e) =>
                setOfficeHours({ ...officeHours, awayMessage: e.target.value })
              }
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
            />
          </div>

          {savedMsg && <p className="text-xs text-emerald-400">{savedMsg}</p>}

          {isSuperAdmin && (
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              Simpan Pengaturan
            </button>
          )}
        </form>
      )}

      {/* Media Kit */}
      {mediaKit && (
        <form
          onSubmit={handleSaveMediaKit}
          className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4"
        >
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Package className="w-4 h-4 text-indigo-400" />
              Paket Media Kit Resmi (1-Klik Kirim di Roomchat)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Info resmi komunitas yang bisa dikirim dalam 1 klik ke calon partner dari Roomchat.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Nama Server / Komunitas</label>
              <input
                disabled={!isSuperAdmin}
                value={mediaKit.serverName}
                onChange={(e) => setMediaKit({ ...mediaKit, serverName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Link Invite Resmi</label>
              <input
                disabled={!isSuperAdmin}
                value={mediaKit.inviteLink}
                onChange={(e) => setMediaKit({ ...mediaKit, inviteLink: e.target.value })}
                placeholder="https://discord.gg/..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">URL Logo (Thumbnail)</label>
              <input
                disabled={!isSuperAdmin}
                value={mediaKit.logoUrl}
                onChange={(e) => setMediaKit({ ...mediaKit, logoUrl: e.target.value })}
                placeholder="https://.../logo.png"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">URL Banner</label>
              <input
                disabled={!isSuperAdmin}
                value={mediaKit.bannerUrl}
                onChange={(e) => setMediaKit({ ...mediaKit, bannerUrl: e.target.value })}
                placeholder="https://.../banner.png"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">Deskripsi Komunitas</label>
            <textarea
              rows={2}
              disabled={!isSuperAdmin}
              value={mediaKit.description}
              onChange={(e) => setMediaKit({ ...mediaKit, description: e.target.value })}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">Syarat & Ketentuan Partnership</label>
            <textarea
              rows={3}
              disabled={!isSuperAdmin}
              value={mediaKit.requirements}
              onChange={(e) => setMediaKit({ ...mediaKit, requirements: e.target.value })}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
            />
          </div>

          {kitSavedMsg && <p className="text-xs text-emerald-400">{kitSavedMsg}</p>}

          {isSuperAdmin && (
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              Simpan Media Kit
            </button>
          )}
        </form>
      )}

      {/* Templates */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <FileText className="w-4 h-4 text-emerald-400" />
          Template Pesan Cepat Roomchat
        </h2>

        {isSuperAdmin && (
          <form onSubmit={handleCreateTemplate} className="space-y-2.5 pb-4 border-b border-slate-800">
            <div className="grid sm:grid-cols-3 gap-2">
              <input
                required
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                placeholder="Nama Template"
                className="sm:col-span-2 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
              />
              <select
                value={tplCat}
                onChange={(e) => setTplCat(e.target.value as ConversationCategory)}
                className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
              >
                <option value="general">Umum</option>
                <option value="partnership">Partnership</option>
                <option value="warning">Pelanggaran</option>
                <option value="reward">Hadiah</option>
                <option value="benefit">Benefit / Role</option>
              </select>
            </div>
            <textarea
              rows={3}
              required
              value={tplContent}
              onChange={(e) => setTplContent(e.target.value)}
              placeholder="Isi pesan template..."
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
            />
            <button
              type="submit"
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Tambah Template
            </button>
          </form>
        )}

        <div className="space-y-2">
          {templates.map((t) => (
            <div
              key={t.id}
              className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white">{t.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                    {t.category}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1 whitespace-pre-wrap">{t.content}</p>
              </div>
              {isSuperAdmin && (
                <button
                  onClick={() => void handleDeleteTemplate(t.id)}
                  className="p-1.5 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

