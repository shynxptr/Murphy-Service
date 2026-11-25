import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  Handshake,
  LayoutDashboard,
  Lightbulb,
  MessageSquare,
  Palette,
  Star,
} from 'lucide-react';
import { apiFetch } from '../api';
import type { OverviewStats } from '../types';

interface Props {
  onOpenConversation: (conversationId: number) => void;
  onNavigate: (page: 'inbox' | 'partners' | 'aspirations' | 'warnings' | 'customroles' | 'events') => void;
}

export function OverviewView({ onOpenConversation, onNavigate }: Props) {
  const [stats, setStats] = useState<OverviewStats | null>(null);

  useEffect(() => {
    apiFetch<{ stats: OverviewStats }>('/api/community/overview')
      .then((res) => setStats(res.stats))
      .catch(() => {});
  }, []);

  if (!stats) {
    return (
      <div className="p-6 text-sm text-slate-400">Memuat ringkasan statistik Humas Desk...</div>
    );
  }

  const cards = [
    {
      label: 'DM Belum Dibalas',
      value: stats.unreadConversations,
      sub: `dari ${stats.totalConversations} total obrolan`,
      icon: MessageSquare,
      color: 'text-indigo-400',
      onClick: () => onNavigate('inbox'),
    },
    {
      label: 'Perlu Follow-Up (>3 Hari)',
      value: stats.followUpCount,
      sub: 'Klaim Hadiah / Benefit menunggu',
      icon: Clock,
      color: stats.followUpCount > 0 ? 'text-amber-400' : 'text-slate-400',
      onClick: () => onNavigate('inbox'),
    },
    {
      label: 'Partner Aktif',
      value: stats.activePartners,
      sub:
        stats.invalidInvites > 0
          ? `⚠️ ${stats.invalidInvites} link invite invalid`
          : 'Semua invite aman',
      icon: Handshake,
      color: 'text-emerald-400',
      onClick: () => onNavigate('partners'),
    },
    {
      label: 'Custom Role Aktif',
      value: stats.activeCustomRoles,
      sub: 'Booster & Benefit (/mrole)',
      icon: Palette,
      color: 'text-pink-400',
      onClick: () => onNavigate('customroles'),
    },
    {
      label: 'Warning Bulan Ini',
      value: stats.warningsThisMonth,
      sub: 'Member & Partner',
      icon: AlertTriangle,
      color: 'text-red-400',
      onClick: () => onNavigate('warnings'),
    },
    {
      label: 'Aspirasi Baru',
      value: stats.newAspirations,
      sub: 'Belum ditinjau (/aspirasi)',
      icon: Lightbulb,
      color: 'text-amber-300',
      onClick: () => onNavigate('aspirations'),
    },
    {
      label: 'Rating Survei Event',
      value: stats.surveyAvgRating ? `${stats.surveyAvgRating} / 5` : '-',
      sub: `${stats.surveyResponses} total respons`,
      icon: Star,
      color: 'text-yellow-400',
      onClick: () => onNavigate('events'),
    },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <LayoutDashboard className="w-5 h-5 text-indigo-400" />
          Dashboard Statistik Humas
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Ringkasan cepat kondisi inbox, partnership, custom role, dan aktivitas komunitas saat ini.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.label}
              onClick={c.onClick}
              className="text-left p-4 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition space-y-2 cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{c.label}</span>
                <Icon className={`w-4 h-4 ${c.color}`} />
              </div>
              <div className="text-2xl font-bold text-white">{c.value}</div>
              <div className="text-[11px] text-slate-500">{c.sub}</div>
            </button>
          );
        })}
      </div>

      {/* Follow-Up List */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            Daftar Klaim Hadiah / Benefit Perlu Follow-Up (&gt; 3 Hari)
          </h2>
          <span className="text-xs text-slate-500">{stats.followUpList.length} obrolan</span>
        </div>

        {stats.followUpList.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">
            🎉 Semua klaim hadiah & benefit terpantau aman — tidak ada yang menggantung lebih dari 3 hari.
          </p>
        ) : (
          <div className="divide-y divide-slate-800">
            {stats.followUpList.map((conv) => (
              <div key={conv.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white flex items-center gap-2">
                    <span>{conv.discord_username}</span>
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px]">
                      {conv.category === 'reward' ? 'Hadiah' : 'Benefit / Role'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                    Terakhir: {conv.last_message_preview || '-'} •{' '}
                    {new Date(conv.last_message_at + 'Z').toLocaleDateString('id-ID')}
                  </p>
                </div>
                <button
                  onClick={() => onOpenConversation(conv.id)}
                  className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium cursor-pointer"
                >
                  Follow-Up Sekarang
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

