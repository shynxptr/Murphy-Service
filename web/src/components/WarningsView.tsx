import { useEffect, useState } from 'react';
import { AlertTriangle, Download, Trash2 } from 'lucide-react';
import { apiFetch } from '../api';
import type { AuthUser, WarningRecord } from '../types';

interface Props {
  user: AuthUser;
}

export function WarningsView({ user }: Props) {
  const [warnings, setWarnings] = useState<WarningRecord[]>([]);

  async function load() {
    const res = await apiFetch<{ warnings: WarningRecord[] }>('/api/warnings');
    setWarnings(res.warnings);
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleDelete(id: number) {
    if (!confirm('Hapus catatan warning ini?')) return;
    await apiFetch(`/api/warnings/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            Log Warning & Strike
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Riwayat seluruh peringatan resmi yang dikirimkan ke member maupun partner.
          </p>
        </div>

        <a
          href="/api/warnings/export/csv"
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </a>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950/70 text-slate-400 uppercase text-[11px] border-b border-slate-800">
            <tr>
              <th className="p-3">Target</th>
              <th className="p-3">Tipe</th>
              <th className="p-3">Level</th>
              <th className="p-3">Alasan Pelanggaran</th>
              <th className="p-3">Diberikan Oleh</th>
              <th className="p-3">Tanggal</th>
              {user.role === 'superadmin' && <th className="p-3 text-right">Aksi</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {warnings.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">
                  Belum ada catatan warning.
                </td>
              </tr>
            )}
            {warnings.map((w) => (
              <tr key={w.id} className="hover:bg-slate-800/40">
                <td className="p-3">
                  <div className="font-medium text-white">{w.target_username}</div>
                  <div className="text-[10px] font-mono text-slate-500">{w.target_discord_id}</div>
                </td>
                <td className="p-3 capitalize text-slate-300">{w.target_type}</td>
                <td className="p-3">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      w.level >= 3
                        ? 'bg-red-500/20 text-red-300'
                        : w.level === 2
                        ? 'bg-orange-500/20 text-orange-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    Level {w.level}
                  </span>
                </td>
                <td className="p-3 text-slate-200 max-w-md">{w.reason}</td>
                <td className="p-3 text-slate-400">{w.issued_by}</td>
                <td className="p-3 text-slate-400">
                  {new Date(w.created_at + 'Z').toLocaleString('id-ID')}
                </td>
                {user.role === 'superadmin' && (
                  <td className="p-3 text-right">
                    <button
                      onClick={() => void handleDelete(w.id)}
                      className="p-1 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 cursor-pointer"
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
    </div>
  );
}

