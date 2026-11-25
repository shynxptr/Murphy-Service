import { useEffect, useState, type FormEvent } from 'react';
import { Calendar, Plus, Star, Users, X } from 'lucide-react';
import { apiFetch } from '../api';
import type { EventInvite, Partner, Survey, SurveyResponse } from '../types';

export function EventsView() {
  const [events, setEvents] = useState<EventInvite[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [selectedSurvey, setSelectedSurvey] = useState<Survey | null>(null);
  const [surveyResponses, setSurveyResponses] = useState<SurveyResponse[]>([]);

  // New Event Modal
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [evTitle, setEvTitle] = useState('');
  const [evDate, setEvDate] = useState('');
  const [evDesc, setEvDesc] = useState('');
  const [evPartnerIds, setEvPartnerIds] = useState<number[]>([]);

  // New Survey Modal
  const [showNewSurvey, setShowNewSurvey] = useState(false);
  const [svTitle, setSvTitle] = useState('');
  const [svDesc, setSvDesc] = useState('');

  async function loadAll() {
    const [e, p, s] = await Promise.all([
      apiFetch<{ events: EventInvite[] }>('/api/community/events'),
      apiFetch<{ partners: Partner[] }>('/api/partners'),
      apiFetch<{ surveys: Survey[] }>('/api/community/surveys'),
    ]);
    setEvents(e.events);
    setPartners(p.partners.filter((x) => x.status === 'active'));
    setSurveys(s.surveys);
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function handleCreateEvent(e: FormEvent) {
    e.preventDefault();
    await apiFetch('/api/community/events', {
      method: 'POST',
      body: JSON.stringify({
        title: evTitle,
        event_date: evDate,
        description: evDesc,
        partner_ids: evPartnerIds,
      }),
    });
    setEvTitle('');
    setEvDate('');
    setEvDesc('');
    setEvPartnerIds([]);
    setShowNewEvent(false);
    await loadAll();
  }

  async function handleCreateSurvey(e: FormEvent) {
    e.preventDefault();
    await apiFetch('/api/community/surveys', {
      method: 'POST',
      body: JSON.stringify({ title: svTitle, description: svDesc }),
    });
    setSvTitle('');
    setSvDesc('');
    setShowNewSurvey(false);
    await loadAll();
  }

  async function toggleSurvey(s: Survey) {
    await apiFetch(`/api/community/surveys/${s.id}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: s.is_active === 0 }),
    });
    await loadAll();
  }

  async function openSurveyResponses(s: Survey) {
    setSelectedSurvey(s);
    const res = await apiFetch<{ responses: SurveyResponse[] }>(
      `/api/community/surveys/${s.id}/responses`
    );
    setSurveyResponses(res.responses);
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      {/* SECTION 1: Event Invites & Partner RSVP */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Calendar className="w-5 h-5 text-indigo-400" />
              Undangan Event & RSVP Partner
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Kirim undangan event dengan tombol konfirmasi RSVP (Hadir / Perwakilan / Tidak Hadir) ke PIC partner.
            </p>
          </div>
          <button
            onClick={() => {
              setEvPartnerIds(partners.map((p) => p.id));
              setShowNewEvent(true);
            }}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Buat Undangan Event
          </button>
        </div>

        <div className="grid gap-4">
          {events.length === 0 && (
            <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-500">
              Belum ada undangan event partner.
            </div>
          )}
          {events.map((ev) => (
            <div
              key={ev.id}
              className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-white">{ev.title}</h3>
                  <p className="text-xs text-indigo-300 mt-0.5">📅 {ev.event_date}</p>
                  {ev.description && (
                    <p className="text-xs text-slate-400 mt-1">{ev.description}</p>
                  )}
                </div>
                <span className="text-[11px] text-slate-500">Dibuat oleh {ev.created_by}</span>
              </div>

              {ev.rsvps && ev.rsvps.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800">
                  {ev.rsvps.map((r) => (
                    <div
                      key={r.id}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs flex items-center gap-2"
                    >
                      <span className="text-slate-200 font-medium">{r.server_name}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          r.status === 'attending'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : r.status === 'representative'
                            ? 'bg-sky-500/20 text-sky-300'
                            : r.status === 'declined'
                            ? 'bg-slate-700 text-slate-300'
                            : r.status === 'failed'
                            ? 'bg-red-500/20 text-red-300'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {r.status === 'attending'
                          ? 'Hadir'
                          : r.status === 'representative'
                          ? 'Perwakilan'
                          : r.status === 'declined'
                          ? 'Tidak Hadir'
                          : r.status === 'failed'
                          ? 'DM Gagal'
                          : 'Menunggu'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 2: Post-Event Surveys */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Star className="w-5 h-5 text-amber-400" />
              Survei Evaluasi Event (/survei)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Member & partner bisa mengisi survei aktif langsung dari Discord menggunakan slash command <code>/survei</code>.
            </p>
          </div>
          <button
            onClick={() => setShowNewSurvey(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Buat Survei Baru
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {surveys.map((s) => (
            <div
              key={s.id}
              className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between gap-3"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-white text-sm">{s.title}</h3>
                  <button
                    onClick={() => void toggleSurvey(s)}
                    className={`text-[11px] px-2 py-0.5 rounded-full cursor-pointer ${
                      s.is_active
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {s.is_active ? 'Aktif' : 'Nonaktif'}
                  </button>
                </div>
                {s.description && <p className="text-xs text-slate-400 mt-1">{s.description}</p>}
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
                <div className="flex items-center gap-3 text-slate-300">
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5 text-slate-400" />
                    {s.response_count || 0} respons
                  </span>
                  <span className="flex items-center gap-1 text-amber-400 font-semibold">
                    <Star className="w-3.5 h-3.5 fill-amber-400" />
                    {s.avg_rating || '-'} / 5
                  </span>
                </div>
                <button
                  onClick={() => void openSurveyResponses(s)}
                  className="text-indigo-400 hover:underline cursor-pointer"
                >
                  Lihat Masukan
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* New Event Modal */}
      {showNewEvent && (
        <div className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateEvent}
            className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">Kirim Undangan Event & RSVP</h3>
              <button type="button" onClick={() => setShowNewEvent(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <input
              required
              value={evTitle}
              onChange={(e) => setEvTitle(e.target.value)}
              placeholder="Nama Event (misal: Community Gathering 2026)"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
            />
            <input
              required
              value={evDate}
              onChange={(e) => setEvDate(e.target.value)}
              placeholder="Tanggal & Jam (misal: Sabtu, 28 Nov 2026 • 19.30 WIB)"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
            />
            <textarea
              rows={3}
              value={evDesc}
              onChange={(e) => setEvDesc(e.target.value)}
              placeholder="Deskripsi singkat acara..."
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
            />
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Pilih Partner yang Diundang ({evPartnerIds.length})
              </label>
              <div className="max-h-36 overflow-y-auto border border-slate-800 rounded-lg p-2 space-y-1 bg-slate-950">
                {partners.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={evPartnerIds.includes(p.id)}
                      onChange={() =>
                        setEvPartnerIds((prev) =>
                          prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]
                        )
                      }
                    />
                    {p.server_name} ({p.pic_username})
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewEvent(false)}
                className="px-3 py-2 text-xs text-slate-300 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
              >
                Buat & Kirim Undangan
              </button>
            </div>
          </form>
        </div>
      )}

      {/* New Survey Modal */}
      {showNewSurvey && (
        <div className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateSurvey}
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">Buat Survei Evaluasi Event</h3>
              <button type="button" onClick={() => setShowNewSurvey(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <input
              required
              value={svTitle}
              onChange={(e) => setSvTitle(e.target.value)}
              placeholder="Judul Survei (maks 45 karakter)"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
            />
            <textarea
              rows={3}
              value={svDesc}
              onChange={(e) => setSvDesc(e.target.value)}
              placeholder="Keterangan singkat..."
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewSurvey(false)}
                className="px-3 py-2 text-xs text-slate-300 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium cursor-pointer"
              >
                Simpan Survei
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Survey Responses Modal */}
      {selectedSurvey && (
        <div className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">Respons: {selectedSurvey.title}</h3>
              <button onClick={() => setSelectedSurvey(null)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            {surveyResponses.length === 0 ? (
              <p className="text-xs text-slate-500">Belum ada yang mengisi survei ini.</p>
            ) : (
              <div className="space-y-2.5">
                {surveyResponses.map((r) => (
                  <div
                    key={r.id}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs"
                  >
                    <div className="flex justify-between">
                      <span className="font-medium text-white">{r.discord_username}</span>
                      <span className="text-amber-400 font-semibold">★ {r.rating}/5</span>
                    </div>
                    {r.feedback && <p className="text-slate-300 mt-1">{r.feedback}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

