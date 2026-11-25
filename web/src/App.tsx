import { lazy, Suspense, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Calendar,
  EyeOff,
  Handshake,
  Hash,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  Menu,
  MessageSquare,
  Palette,
  Settings,
  Shield,
  ShieldCheck,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import { apiFetch, connectSocket, disconnectSocket } from './api';
import { LoginPage } from './components/LoginPage';
import type { AuthUser, BotStatus, Conversation } from './types';

// Lazy-load views so mobile browsers only download the active page
const OverviewView = lazy(() =>
  import('./components/OverviewView').then((m) => ({ default: m.OverviewView }))
);
const InboxView = lazy(() =>
  import('./components/InboxView').then((m) => ({ default: m.InboxView }))
);
const AnonChatView = lazy(() =>
  import('./components/AnonChatView').then((m) => ({ default: m.AnonChatView }))
);
const QuickChatView = lazy(() =>
  import('./components/QuickChatView').then((m) => ({ default: m.QuickChatView }))
);
const ChannelsView = lazy(() =>
  import('./components/ChannelsView').then((m) => ({ default: m.ChannelsView }))
);
const PartnersView = lazy(() =>
  import('./components/PartnersView').then((m) => ({ default: m.PartnersView }))
);
const CustomRolesView = lazy(() =>
  import('./components/CustomRolesView').then((m) => ({ default: m.CustomRolesView }))
);
const EventsView = lazy(() =>
  import('./components/EventsView').then((m) => ({ default: m.EventsView }))
);
const TournamentsView = lazy(() =>
  import('./components/TournamentsView').then((m) => ({ default: m.TournamentsView }))
);
const AspirationsView = lazy(() =>
  import('./components/AspirationsView').then((m) => ({ default: m.AspirationsView }))
);
const WarningsView = lazy(() =>
  import('./components/WarningsView').then((m) => ({ default: m.WarningsView }))
);
const AuditLogsView = lazy(() =>
  import('./components/AuditLogsView').then((m) => ({ default: m.AuditLogsView }))
);
const SettingsView = lazy(() =>
  import('./components/SettingsView').then((m) => ({ default: m.SettingsView }))
);

type Page =
  | 'overview'
  | 'inbox'
  | 'anonchat'
  | 'quickchat'
  | 'channels'
  | 'partners'
  | 'customroles'
  | 'tournaments'
  | 'events'
  | 'aspirations'
  | 'warnings'
  | 'audit'
  | 'settings';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [page, setPage] = useState<Page>('inbox');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [openConvId, setOpenConvId] = useState<number | null>(() => {
    const param = new URLSearchParams(window.location.search).get('conv');
    return param ? Number(param) : null;
  });
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);

  useEffect(() => {
    apiFetch<{ user: AuthUser }>('/api/auth/me')
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (!user) return;

    apiFetch<{ bot: BotStatus }>('/api/community/status')
      .then((res) => setBotStatus(res.bot))
      .catch(() => {});

    const socket = connectSocket();
    const onNotif = (payload: { title: string; body: string }) => {
      setToast({ title: payload.title, body: payload.body });
      setTimeout(() => setToast(null), 4500);

      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(payload.title, { body: payload.body });
      }
    };

    socket.on('notification:new', onNotif);
    return () => {
      socket.off('notification:new', onNotif);
    };
  }, [user]);

  async function handleLogout() {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    disconnectSocket();
    setUser(null);
  }

  async function handleOpenQuickChat(discordUserId: string, username: string) {
    const res = await apiFetch<{ conversation: Conversation }>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({
        discord_user_id: discordUserId,
        discord_username: username,
        type: 'member',
        category: 'general',
      }),
    });
    setOpenConvId(res.conversation.id);
    setPage('inbox');
    setMobileMenuOpen(false);
  }

  async function handleOpenPartnerChat(discordUserId: string, username: string) {
    const res = await apiFetch<{ conversation: Conversation }>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({
        discord_user_id: discordUserId,
        discord_username: username,
        type: 'partner',
        category: 'partnership',
      }),
    });
    setOpenConvId(res.conversation.id);
    setPage('inbox');
    setMobileMenuOpen(false);
  }

  function enableBrowserNotif() {
    if ('Notification' in window) {
      void Notification.requestPermission();
    }
  }

  if (!authChecked) {
    return (
      <div className="h-[100dvh] bg-slate-950 flex items-center justify-center text-slate-400 text-sm">
        Memuat Humas Desk...
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={setUser} />;
  }

  const navItems: Array<{ id: Page; label: string; icon: typeof MessageSquare }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'inbox', label: 'Roomchat', icon: MessageSquare },
    { id: 'anonchat', label: 'Anon Chat', icon: EyeOff },
    { id: 'quickchat', label: 'Quick Chat', icon: Zap },
    { id: 'channels', label: 'Post Channel', icon: Hash },
    { id: 'partners', label: 'Partners', icon: Handshake },
    { id: 'customroles', label: 'Custom Roles', icon: Palette },
    { id: 'tournaments', label: 'Turnamen', icon: Trophy },
    { id: 'events', label: 'Event & Survei', icon: Calendar },
    { id: 'aspirations', label: 'Aspirasi', icon: Lightbulb },
    { id: 'warnings', label: 'Warnings', icon: AlertTriangle },
    ...(user.role === 'superadmin'
      ? [{ id: 'audit' as Page, label: 'Audit Log', icon: ShieldCheck }]
      : []),
    { id: 'settings', label: 'Pengaturan', icon: Settings },
  ];

  const activeNav = navItems.find((n) => n.id === page);

  const sidebarContent = (
    <>
      <div className="h-14 px-4 border-b border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
            <Shield className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-sm text-white leading-tight truncate">Humas Desk</div>
            <div className="text-[10px] flex items-center gap-1 text-slate-400 truncate">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  botStatus?.ready ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              {botStatus?.ready ? botStatus.tag : 'Bot Offline'}
            </div>
          </div>
        </div>
        <button
          onClick={() => setMobileMenuOpen(false)}
          className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white cursor-pointer"
          aria-label="Tutup menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 p-2.5 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = page === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setPage(item.id);
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                active
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-800 space-y-2">
        <button
          onClick={enableBrowserNotif}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-[11px] text-slate-300 cursor-pointer"
        >
          <Bell className="w-3.5 h-3.5 text-indigo-400" />
          Aktifkan Notif Browser
        </button>
        <div className="flex items-center justify-between pt-1">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white truncate">{user.name}</div>
            <div className="text-[10px] text-slate-400 uppercase">{user.role}</div>
          </div>
          <button
            onClick={() => void handleLogout()}
            title="Keluar"
            className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="h-[100dvh] flex flex-col md:flex-row bg-slate-950 text-slate-100 overflow-hidden">
      {/* Mobile Top Bar */}
      <header className="md:hidden h-12 px-3 border-b border-slate-800 bg-slate-900 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-1.5 rounded-lg text-slate-300 hover:bg-slate-800 cursor-pointer"
            aria-label="Buka menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-semibold text-sm text-white truncate">
            {activeNav?.label || 'Humas Desk'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span
            className={`w-2 h-2 rounded-full ${
              botStatus?.ready ? 'bg-emerald-400' : 'bg-amber-400'
            }`}
          />
          <span>{botStatus?.ready ? 'Online' : 'Offline'}</span>
        </div>
      </header>

      {/* Mobile Slide-Over Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 w-64 max-w-[80vw] h-full bg-slate-900 border-r border-slate-800 flex flex-col">
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 border-r border-slate-800 bg-slate-900 flex-col">
        {sidebarContent}
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative min-w-0">
        <Suspense
          fallback={
            <div className="h-full flex items-center justify-center text-xs text-slate-500">
              Memuat halaman...
            </div>
          }
        >
          {page === 'overview' && (
            <OverviewView
              onOpenConversation={(id) => {
                setOpenConvId(id);
                setPage('inbox');
              }}
              onNavigate={(target) => setPage(target)}
            />
          )}
          {page === 'inbox' && <InboxView user={user} initialConversationId={openConvId} />}
          {page === 'anonchat' && <AnonChatView />}
          {page === 'quickchat' && (
            <QuickChatView onOpenChat={(id, name) => void handleOpenQuickChat(id, name)} />
          )}
          {page === 'channels' && <ChannelsView />}
          {page === 'partners' && (
            <PartnersView
              user={user}
              onOpenChat={(id, name) => void handleOpenPartnerChat(id, name)}
            />
          )}
          {page === 'customroles' && <CustomRolesView user={user} />}
          {page === 'tournaments' && (
            <TournamentsView
              user={user}
              onOpenChat={(id, name) => void handleOpenQuickChat(id, name)}
            />
          )}
          {page === 'events' && <EventsView />}
          {page === 'aspirations' && <AspirationsView />}
          {page === 'warnings' && <WarningsView user={user} />}
          {page === 'audit' && user.role === 'superadmin' && <AuditLogsView />}
          {page === 'settings' && <SettingsView user={user} />}
        </Suspense>

        {/* Live Toast Notification */}
        {toast && (
          <div className="fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-sm bg-slate-900 border border-indigo-500/40 rounded-xl p-3 shadow-xl z-50">
            <div className="text-xs font-semibold text-indigo-300">{toast.title}</div>
            <div className="text-xs text-slate-200 mt-0.5 line-clamp-2">{toast.body}</div>
          </div>
        )}
      </main>
    </div>
  );
}
