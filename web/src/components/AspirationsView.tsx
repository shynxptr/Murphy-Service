import { useEffect, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { apiFetch } from '../api';
import type { Aspiration } from '../types';

export function AspirationsView() {
  const [items, setItems] = useState<Aspiration[]>([]);

  async function load() {
    const res = await apiFetch<{ aspirations: Aspiration[] }>('/api/community/aspirations');
    setItems(res.aspirations);
  }

  useEffect(() => {
    void load();
  }, []);

  async function updateItem(item: Aspiration, status: Aspiration['status'], notes?: string) {
    await apiFetch(`/api/community/aspirations/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        admin_notes: notes !== undefined ? notes : item.admin_notes,
      }),
    });
    await load();
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-amber-400" />
          Kotak Aspirasi & Saran Member
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Masukan yang dikirim member lewat slash command <code>/aspirasi</code> di Discord (bisa anonim).
        </p>
      </div>

      {items.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-500">
          Belum ada aspirasi masuk.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-medium">
                    {item.category}
                  </span>
                  <span className="text-xs text-slate-300 font-medium">
                    Dari: {item.sender_label}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    • {new Date(item.created_at + 'Z').toLocaleString('id-ID')}
                  </span>
                </div>

                <select
                  value={item.status}
                  onChange={(e) =>
                    void updateItem(item, e.target.value as Aspiration['status'])
                  }
                  className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                >
                  <option value="new">Baru</option>
                  <option value="reviewed">Sudah Dibahas</option>
                  <option value="resolved">Ditindaklanjuti / Selesai</option>
                </select>
              </div>

              <p className="text-sm text-slate-100 whitespace-pre-wrap">{item.content}</p>

              <input
                defaultValue={item.admin_notes}
                onBlur={(e) => {
                  if (e.target.value !== item.admin_notes) {
                    void updateItem(item, item.status, e.target.value);
                  }
                }}
                placeholder="Tambah catatan internal tim Humas..."
                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

