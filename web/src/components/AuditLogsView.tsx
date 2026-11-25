import { useEffect, useState } from 'react';
import { Download, Search, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../api';
import type { AuditLog } from '../types';

const ACTION_META: Record<string, { label: string; color: string }> = {
  login: { label: 'Login', color: 'bg-slate-700 text-slate-200' },
  channel_post: { label: 'Post Channel', color: 'bg-indigo-500/20 text-indigo-300' },
  partner_create: { label: 'Tambah Partner', color: 'bg-emerald-500/20 text-emerald-300' },
  partner_update: { label: 'Edit Partner', color: 'bg-sky-500/20 text-sky-300' },
  partner_delete: { label: 'Hapus Partner', color: 'bg-red-500/20 text-red-300' },
  partner_broadcast: { label: 'Broadcast Partner', color: 'bg-purple-500/20 text-purple-300' },
  warning_issue: { label: 'Beri Warning', color: 'bg-amber-500/20 text-amber-300' },
  warning_delete: { label: 'Hapus Warning', color: 'bg-red-500/20 text-red-300' },
  quick_reminder: { label: 'Quick Reminder', color: 'bg-amber-500/20 text-amber-300' },
  settings_update: { label: 'Ubah Pengaturan', color: 'bg-slate-700 text-slate-200' },
};

export function AuditLogsView() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [action, setAction] = useState('all');
  const [search, setSearch] = useState('');

  async function load() {
    const params = new URLSearchParams();
    if (action !== 'all') params.set('action', action);
    if (search.trim()) params.set('search', search.trim());
    const res = await apiFetch<{ logs: AuditLog[] }>(`/api/audit-logs?${params.toString()}`);
    setLogs(res.logs);
  }

  useEffect(() => {
    void load();
  }, [action, search]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            Audit Log Aktivitas Admin
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Riwayat seluruh tindakan penting tim Humas di web panel (khusus Super Admin).
          </p>
        </div>

        <a
          href="/api/audit-logs/export/csv"
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </a>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-60">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama admin, target, atau detail..."
            className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
          />
        </div>

        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white"
        >
          <option value="all">Semua Aksi</option>
          {Object.entries(ACTION_META).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950/70 text-slate-400 uppercase text-[11px] border-b border-slate-800">
            <tr>
              <th className="p-3">Waktu</th>
              <th className="p-3">Admin</th>
              <th className="p-3">Aksi</th>
              <th className="p-3">Target</th>
              <th className="p-3">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-500">
                  Belum ada catatan aktivitas.
                </td>
              </tr>
            )}
            {logs.map((log) => {
              const meta = ACTION_META[log.action] || {
                label: log.action,
                color: 'bg-slate-800 text-slate-300',
              };
              return (
                <tr key={log.id} className="hover:bg-slate-800/40">
                  <td className="p-3 text-slate-400 whitespace-nowrap">
                    {new Date(log.created_at + 'Z').toLocaleString('id-ID')}
                  </td>
                  <td className="p-3">
                    <div className="font-medium text-white">{log.admin_name}</div>
                    <div className="text-[10px] text-slate-500 uppercase">
                      @{log.admin_username} • {log.admin_role}
                    </div>
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${meta.color}`}>
                      {meta.label}
                    </span>
                  </td>
                  <td className="p-3 text-slate-200 font-medium">{log.target || '-'}</td>
                  <td className="p-3 text-slate-400 max-w-md truncate">{log.details || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

