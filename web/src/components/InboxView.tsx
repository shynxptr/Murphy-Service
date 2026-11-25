import {
  memo,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
} from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  FileText,
  Image as ImageIcon,
  Info,
  Lock,
  MessageSquarePlus,
  Package,
  Palette,
  Paperclip,
  Search,
  Send,
  ShieldAlert,
  StickyNote,
  X,
  Zap,
} from 'lucide-react';
import { apiFetch, connectSocket } from '../api';
import type {
  AuthUser,
  ChatMessage,
  Conversation,
  ConversationCategory,
  ConversationStatus,
  GuildMemberOption,
  MessageTemplate,
  Partner,
  WarningRecord,
} from '../types';

interface Props {
  user: AuthUser;
  initialConversationId?: number | null;
}

const CATEGORY_LABELS: Record<ConversationCategory, { label: string; color: string }> = {
  general: { label: 'Umum', color: 'bg-slate-700 text-slate-200' },
  partnership: { label: 'Partnership', color: 'bg-indigo-500/20 text-indigo-300' },
  warning: { label: 'Pelanggaran', color: 'bg-red-500/20 text-red-300' },
  reward: { label: 'Hadiah', color: 'bg-emerald-500/20 text-emerald-300' },
  benefit: { label: 'Benefit / Role', color: 'bg-amber-500/20 text-amber-300' },
};

const STATUS_LABELS: Record<ConversationStatus, { label: string; color: string }> = {
  open: { label: 'Baru / Open', color: 'text-sky-400' },
  waiting_reply: { label: 'Menunggu Balasan', color: 'text-amber-400' },
  in_progress: { label: 'Diproses', color: 'text-indigo-400' },
  resolved: { label: 'Selesai', color: 'text-emerald-400' },
};

function isNeedsFollowUp(c: Conversation): boolean {
  if (c.status !== 'waiting_reply') return false;
  if (c.category !== 'reward' && c.category !== 'benefit') return false;
  const lastMs = new Date(c.last_message_at + 'Z').getTime();
  return Date.now() - lastMs >= 3 * 24 * 60 * 60 * 1000;
}

// Memoized message bubble so typing in the composer never re-renders message history
const MessageBubble = memo(function MessageBubble({
  m,
  onZoom,
}: {
  m: ChatMessage;
  onZoom: (url: string) => void;
}) {
  const isAdmin = m.sender_type === 'admin';
  const isNote = m.sender_type === 'internal_note';
  const isSystem = m.sender_type === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="max-w-md text-center px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
          <span className="font-medium text-slate-300">{m.sender_name}:</span> {m.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${isAdmin || isNote ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${
          isNote
            ? 'bg-amber-500/15 border border-amber-500/40 text-amber-100'
            : isAdmin
            ? 'bg-indigo-600 text-white'
            : 'bg-slate-800 text-slate-100'
        }`}
      >
        {isNote && (
          <div className="flex items-center gap-1 text-[11px] font-semibold text-amber-300 mb-1">
            <StickyNote className="w-3 h-3" /> Catatan Internal
          </div>
        )}
        {m.content && <div>{m.content}</div>}

        {m.attachments.length > 0 && (
          <div className="mt-2 space-y-2">
            {m.attachments.map((att) =>
              att.mimeType.startsWith('image/') ? (
                <img
                  key={att.filename}
                  src={att.url}
                  alt={att.originalName}
                  loading="lazy"
                  decoding="async"
                  onClick={() => onZoom(att.url)}
                  className="max-h-56 rounded-lg border border-black/20 cursor-zoom-in"
                />
              ) : (
                <a
                  key={att.filename}
                  href={att.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs underline opacity-90"
                >
                  <FileText className="w-3.5 h-3.5" />
                  {att.originalName}
                </a>
              )
            )}
          </div>
        )}
      </div>
      <span className="text-[10px] text-slate-500 mt-1 px-1">
        {isAdmin || isNote ? `Oleh ${m.sender_name}` : m.sender_name} •{' '}
        {new Date(m.created_at + 'Z').toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
        })}
        {m.delivery_channel === 'thread' ? ' • Thread' : ''}
      </span>
    </div>
  );
});

export function InboxView({ user, initialConversationId }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [tab, setTab] = useState<'all' | 'partner' | 'member' | 'followup'>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(initialConversationId || null);
  const [showInfoDrawer, setShowInfoDrawer] = useState(false);

  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [warnings, setWarnings] = useState<WarningRecord[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [viewers, setViewers] = useState<Array<{ username: string; name: string; typing: boolean }>>(
    []
  );

  // Composer state
  const [text, setText] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [statusBanner, setStatusBanner] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Quick Warning modal
  const [showWarnModal, setShowWarnModal] = useState(false);
  const [warnLevel, setWarnLevel] = useState(1);
  const [warnReason, setWarnReason] = useState('');
  const [warnLoading, setWarnLoading] = useState(false);

  // New Chat modal
  const [showNewChat, setShowNewChat] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState<GuildMemberOption[]>([]);
  const [manualUserId, setManualUserId] = useState('');
  const [manualUsername, setManualUsername] = useState('');
  const [newChatCategory, setNewChatCategory] = useState<ConversationCategory>('general');

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimerRef = useRef<number | null>(null);

  // Debounce search to avoid heavy requests on every keystroke
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  async function loadConversations() {
    const params = new URLSearchParams();
    if (tab === 'partner' || tab === 'member') params.set('type', tab);
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
    const data = await apiFetch<{ conversations: Conversation[] }>(
      `/api/conversations?${params.toString()}`
    );
    setConversations(
      tab === 'followup' ? data.conversations.filter(isNeedsFollowUp) : data.conversations
    );
  }

  async function loadConversationDetail(id: number) {
    const data = await apiFetch<{
      conversation: Conversation;
      messages: ChatMessage[];
      warnings: WarningRecord[];
      partners: Partner[];
    }>(`/api/conversations/${id}`);
    setActiveConv(data.conversation);
    setMessages(data.messages);
    setWarnings(data.warnings);
    setPartners(data.partners);

    if (data.conversation.unread_count > 0) {
      await apiFetch(`/api/conversations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ mark_read: true }),
      }).catch(() => {});
    }
  }

  useEffect(() => {
    void loadConversations();
  }, [tab, debouncedSearch]);

  useEffect(() => {
    apiFetch<{ templates: MessageTemplate[] }>('/api/templates')
      .then((d) => setTemplates(d.templates))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setActiveConv(null);
      return;
    }
    void loadConversationDetail(selectedId);
    const socket = connectSocket();
    socket.emit('conversation:join', selectedId);
    return () => {
      socket.emit('conversation:leave', selectedId);
    };
  }, [selectedId]);

  useEffect(() => {
    const socket = connectSocket();

    const onNewMessage = ({
      conversation,
      message,
    }: {
      conversation: Conversation;
      message: ChatMessage;
    }) => {
      setConversations((prev) => {
        const filtered = prev.filter((c) => c.id !== conversation.id);
        return [conversation, ...filtered];
      });
      if (conversation.id === selectedId) {
        setActiveConv(conversation);
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      }
    };

    const onConvUpdated = (conversation: Conversation) => {
      setConversations((prev) => {
        const exists = prev.some((c) => c.id === conversation.id);
        if (!exists) return [conversation, ...prev];
        return prev.map((c) => (c.id === conversation.id ? conversation : c));
      });
      if (conversation.id === selectedId) {
        setActiveConv(conversation);
      }
    };

    const onPresence = (payload: {
      conversationId: number;
      viewers: Array<{ username: string; name: string; typing: boolean }>;
    }) => {
      if (payload.conversationId === selectedId) {
        setViewers(payload.viewers.filter((v) => v.username !== user.username));
      }
    };

    socket.on('message:new', onNewMessage);
    socket.on('conversation:updated', onConvUpdated);
    socket.on('conversation:presence', onPresence);
    return () => {
      socket.off('message:new', onNewMessage);
      socket.off('conversation:updated', onConvUpdated);
      socket.off('conversation:presence', onPresence);
    };
  }, [selectedId, user.username]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages.length, selectedId]);

  function handleTyping(val: string) {
    setText(val);
    if (!selectedId) return;
    const socket = connectSocket();
    socket.emit('conversation:typing', { conversationId: selectedId, typing: true });
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      socket.emit('conversation:typing', { conversationId: selectedId, typing: false });
    }, 2000);
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const pastedFiles: File[] = [];
    for (const item of e.clipboardData.items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) pastedFiles.push(f);
      }
    }
    if (pastedFiles.length > 0) {
      setFiles((prev) => [...prev, ...pastedFiles].slice(0, 4));
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files || []);
    if (dropped.length > 0) {
      setFiles((prev) => [...prev, ...dropped].slice(0, 4));
    }
  }

  async function handleSend(e?: FormEvent) {
    e?.preventDefault();
    if (!selectedId || (!text.trim() && files.length === 0) || sending) return;
    setStatusBanner('');
    setSending(true);
    try {
      const form = new FormData();
      form.append('content', text);
      form.append('is_internal_note', String(isInternalNote));
      for (const f of files) {
        form.append('files', f);
      }
      await apiFetch(`/api/conversations/${selectedId}/messages`, {
        method: 'POST',
        body: form,
      });
      setText('');
      setFiles([]);
      setIsInternalNote(false);
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Gagal mengirim pesan.');
    } finally {
      setSending(false);
    }
  }

  async function handleCreateFallbackThread() {
    if (!selectedId) return;
    setStatusBanner('');
    try {
      await apiFetch(`/api/conversations/${selectedId}/fallback-thread`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await loadConversationDetail(selectedId);
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Gagal membuat Private Thread.');
    }
  }

  async function handleUpdateMeta(updates: Partial<Conversation>) {
    if (!selectedId) return;
    await apiFetch(`/api/conversations/${selectedId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async function handleIssueWarning(e: FormEvent) {
    e.preventDefault();
    if (!activeConv || !warnReason.trim()) return;
    setWarnLoading(true);
    try {
      await apiFetch('/api/warnings', {
        method: 'POST',
        body: JSON.stringify({
          target_discord_id: activeConv.discord_user_id,
          target_username: activeConv.discord_username,
          target_type: activeConv.type,
          partner_id: partners[0]?.id || null,
          level: warnLevel,
          reason: warnReason,
          send_dm: true,
        }),
      });
      setWarnReason('');
      setShowWarnModal(false);
      await loadConversationDetail(activeConv.id);
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Gagal memberi warning.');
    } finally {
      setWarnLoading(false);
    }
  }

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

  async function startConversation(discordUserId: string, discordUsername: string, avatar?: string) {
    const res = await apiFetch<{ conversation: Conversation }>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({
        discord_user_id: discordUserId,
        discord_username: discordUsername,
        discord_avatar: avatar || null,
        category: newChatCategory,
      }),
    });
    setShowNewChat(false);
    setManualUserId('');
    setManualUsername('');
    setSelectedId(res.conversation.id);
    await loadConversations();
  }

  async function handleSendMediaKit() {
    if (!activeConv) return;
    try {
      await apiFetch(`/api/conversations/${activeConv.id}/send-mediakit`, { method: 'POST' });
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Gagal kirim Media Kit.');
    }
  }

  async function handleGrantCustomRole() {
    if (!activeConv) return;
    await apiFetch('/api/custom-roles/grant', {
      method: 'POST',
      body: JSON.stringify({
        discord_user_id: activeConv.discord_user_id,
        discord_username: activeConv.discord_username,
        notify_dm: true,
      }),
    });
    setStatusBanner('Akses Custom Role (/mrole) berhasil diberikan & diinfokan via DM!');
    setTimeout(() => setStatusBanner(''), 3000);
  }

  async function handleSaveQuickChat() {
    if (!activeConv) return;
    await apiFetch('/api/quick-contacts', {
      method: 'POST',
      body: JSON.stringify({
        discord_user_id: activeConv.discord_user_id,
        discord_username: activeConv.discord_username,
        label: activeConv.discord_username,
        group_tag: activeConv.category === 'benefit' ? 'benefit' : 'staff',
      }),
    });
    setStatusBanner('Berhasil disimpan ke daftar Quick Chat!');
    setTimeout(() => setStatusBanner(''), 2500);
  }

  const infoPanelContent = activeConv && (
    <div className="space-y-4">
      {/* Quick Actions (super handy on mobile inside drawer) */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => void handleSendMediaKit()}
          className="flex items-center justify-center gap-1.5 text-xs py-2 px-2 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 cursor-pointer"
        >
          <Package className="w-3.5 h-3.5" /> Media Kit
        </button>
        <button
          onClick={() => void handleGrantCustomRole()}
          className="flex items-center justify-center gap-1.5 text-xs py-2 px-2 rounded-lg bg-pink-500/15 hover:bg-pink-500/25 text-pink-300 border border-pink-500/30 cursor-pointer"
        >
          <Palette className="w-3.5 h-3.5" /> Grant Role
        </button>
        <button
          onClick={() => void handleSaveQuickChat()}
          className="flex items-center justify-center gap-1.5 text-xs py-2 px-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 cursor-pointer"
        >
          <Zap className="w-3.5 h-3.5" /> Quick Chat
        </button>
        <button
          onClick={() => {
            setShowInfoDrawer(false);
            setShowWarnModal(true);
          }}
          className="flex items-center justify-center gap-1.5 text-xs py-2 px-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 cursor-pointer"
        >
          <AlertTriangle className="w-3.5 h-3.5" /> Warning
        </button>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
          Detail Kasus
        </h3>
        <div className="space-y-3 bg-slate-950/70 p-3 rounded-xl border border-slate-800">
          <div>
            <label className="text-[11px] text-slate-400">Discord ID</label>
            <div className="text-xs font-mono text-slate-200 select-all">
              {activeConv.discord_user_id}
            </div>
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Kategori</label>
            <select
              value={activeConv.category}
              onChange={(e) =>
                void handleUpdateMeta({ category: e.target.value as ConversationCategory })
              }
              className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
            >
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Status</label>
            <select
              value={activeConv.status}
              onChange={(e) =>
                void handleUpdateMeta({ status: e.target.value as ConversationStatus })
              }
              className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
            >
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {partners.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Info Partner Terkait
          </h3>
          {partners.map((p) => (
            <div
              key={p.id}
              className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-1.5 text-xs"
            >
              <div className="font-semibold text-indigo-300">{p.server_name}</div>
              <div className="text-slate-400">
                Strike: {p.strikes} • Status: {p.status}
              </div>
              {p.backup_pic_name && (
                <div className="text-slate-400">PIC Cadangan: {p.backup_pic_name}</div>
              )}
              {p.collaboration_history && (
                <div className="text-slate-300 pt-1 border-t border-slate-800 whitespace-pre-wrap">
                  {p.collaboration_history}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
          Riwayat Warning ({warnings.length})
        </h3>
        {warnings.length === 0 ? (
          <p className="text-xs text-slate-500">Bersih — belum ada catatan warning.</p>
        ) : (
          <div className="space-y-2">
            {warnings.map((w) => (
              <div
                key={w.id}
                className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs"
              >
                <div className="font-semibold text-red-300">Level {w.level}</div>
                <p className="text-slate-200 mt-0.5">{w.reason}</p>
                <div className="text-[10px] text-slate-400 mt-1">
                  Oleh {w.issued_by} • {new Date(w.created_at + 'Z').toLocaleDateString('id-ID')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* LEFT COLUMN: Conversation List (full width on mobile when no chat selected) */}
      <div
        className={`${
          selectedId ? 'hidden md:flex' : 'flex'
        } w-full md:w-80 shrink-0 border-r border-slate-800 bg-slate-900/60 flex-col`}
      >
        <div className="p-3 border-b border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm text-white">Roomchat Humas</h2>
            <button
              onClick={() => {
                setShowNewChat(true);
                void searchMembers('');
              }}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium cursor-pointer"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              Chat Baru
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari username / ID..."
              className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="grid grid-cols-4 gap-1 bg-slate-950 p-1 rounded-lg text-[11px]">
            {(['all', 'partner', 'member', 'followup'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`py-1 rounded-md transition cursor-pointer ${
                  tab === t
                    ? 'bg-slate-800 text-white font-medium'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t === 'all'
                  ? 'Semua'
                  : t === 'partner'
                  ? 'Partner'
                  : t === 'member'
                  ? 'Member'
                  : 'Follow-Up'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
          {conversations.length === 0 && (
            <div className="p-6 text-center text-xs text-slate-500">
              Belum ada obrolan. Klik "Chat Baru" atau tunggu DM masuk ke bot.
            </div>
          )}
          {conversations.map((c) => {
            const cat = CATEGORY_LABELS[c.category] || CATEGORY_LABELS.general;
            return (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`w-full text-left p-3 hover:bg-slate-800/60 active:bg-slate-800 transition flex items-start gap-2.5 cursor-pointer ${
                  selectedId === c.id ? 'bg-slate-800/90 border-l-2 border-indigo-500' : ''
                }`}
              >
                <div className="w-10 h-10 md:w-9 md:h-9 rounded-full bg-slate-800 border border-slate-700 overflow-hidden shrink-0 flex items-center justify-center text-xs font-bold text-indigo-300">
                  {c.discord_avatar ? (
                    <img
                      src={c.discord_avatar}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    c.discord_username.slice(0, 2).toUpperCase()
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-medium text-white truncate">
                      {c.discord_username}
                    </span>
                    {c.unread_count > 0 && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-indigo-600 text-white">
                        {c.unread_count}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 truncate mt-0.5">
                    {c.last_message_preview || 'Belum ada pesan'}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${cat.color}`}>
                      {cat.label}
                    </span>
                    {isNeedsFollowUp(c) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" /> Follow-Up
                      </span>
                    )}
                    {c.dm_blocked === 1 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300">
                        DM Tutup
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* CENTER COLUMN: Active Roomchat (hidden on mobile when no chat selected) */}
      <div
        className={`${
          selectedId ? 'flex' : 'hidden md:flex'
        } flex-1 flex-col bg-slate-950 min-w-0`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {!activeConv ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-6 text-center">
            <ShieldAlert className="w-12 h-12 text-slate-700 mb-3" />
            <p className="text-sm font-medium text-slate-300">Pilih obrolan di sebelah kiri</p>
            <p className="text-xs mt-1 max-w-sm">
              Semua pesan yang kamu kirim di sini akan diteruskan secara anonim atas nama Bot Humas.
            </p>
          </div>
        ) : (
          <>
            {/* Compact Mobile-Friendly Chat Header */}
            <div className="h-14 px-3 sm:px-4 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  onClick={() => setSelectedId(null)}
                  className="md:hidden p-1.5 -ml-1 rounded-lg text-slate-300 hover:bg-slate-800 cursor-pointer"
                  aria-label="Kembali ke daftar chat"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-sm sm:text-base text-white truncate">
                      {activeConv.discord_username}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300 shrink-0">
                      {activeConv.type === 'partner' ? 'Partner' : 'Member'}
                    </span>
                    {activeConv.fallback_thread_id && (
                      <span className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 shrink-0">
                        Thread
                      </span>
                    )}
                  </div>
                  {viewers.length > 0 && (
                    <p className="text-[11px] text-indigo-400 truncate">
                      {viewers.some((v) => v.typing)
                        ? `${viewers.find((v) => v.typing)?.name} mengetik...`
                        : `Dilihat ${viewers.map((v) => v.name).join(', ')}`}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => setShowWarnModal(true)}
                  className="hidden sm:flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 cursor-pointer"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Warning
                </button>
                <button
                  onClick={() => setShowInfoDrawer(true)}
                  className="lg:hidden p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                  title="Detail & Aksi Cepat"
                  aria-label="Info & Aksi"
                >
                  <Info className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* DM Blocked Banner */}
            {activeConv.dm_blocked === 1 && !activeConv.fallback_thread_id && (
              <div className="px-3 sm:px-4 py-2 bg-red-500/10 border-b border-red-500/30 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-red-200 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-red-400 shrink-0" />
                  <span>DM member tertutup.</span>
                </div>
                <button
                  onClick={handleCreateFallbackThread}
                  className="text-xs px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium cursor-pointer"
                >
                  Kirim via Private Thread
                </button>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-2.5">
              {messages.map((m) => (
                <MessageBubble key={m.id} m={m} onZoom={setLightboxUrl} />
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Status / Error alert */}
            {statusBanner && (
              <div className="mx-3 sm:mx-4 mb-2 px-3 py-2 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-xs text-indigo-200 flex items-center justify-between">
                <span>{statusBanner}</span>
                <button onClick={() => setStatusBanner('')} className="cursor-pointer">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Composer */}
            <form
              onSubmit={handleSend}
              className={`p-2.5 sm:p-3 border-t border-slate-800 shrink-0 ${
                isInternalNote ? 'bg-amber-950/20' : 'bg-slate-900/60'
              }`}
            >
              {files.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {files.map((f, idx) => (
                    <div
                      key={`${f.name}-${idx}`}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[11px] text-slate-200"
                    >
                      <ImageIcon className="w-3 h-3 text-indigo-400" />
                      <span className="max-w-28 truncate">{f.name}</span>
                      <button
                        type="button"
                        onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-slate-400 hover:text-red-400 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 relative">
                  <button
                    type="button"
                    onClick={() => setIsInternalNote((v) => !v)}
                    className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border transition cursor-pointer ${
                      isInternalNote
                        ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                        : 'bg-slate-800 border-slate-700 text-slate-300'
                    }`}
                  >
                    <StickyNote className="w-3 h-3" />
                    {isInternalNote ? 'Note Aktif' : 'Note'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowTemplates((v) => !v)}
                    className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300 cursor-pointer"
                  >
                    <FileText className="w-3 h-3" />
                    Template
                  </button>

                  {showTemplates && (
                    <div className="absolute bottom-8 left-0 w-64 sm:w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-xl p-1.5 z-20 max-h-56 overflow-y-auto">
                      {templates.map((tpl) => (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => {
                            setText(tpl.content);
                            setShowTemplates(false);
                          }}
                          className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-800 text-xs cursor-pointer"
                        >
                          <div className="font-medium text-white">{tpl.name}</div>
                          <div className="text-slate-400 truncate">{tpl.content}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <span className="hidden sm:inline text-[11px] text-slate-500">
                  Ctrl+V untuk paste screenshot
                </span>
              </div>

              <div className="flex items-end gap-1.5 sm:gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files || []);
                    setFiles((prev) => [...prev, ...picked].slice(0, 4));
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Lampirkan gambar/PDF"
                  className="p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0 cursor-pointer"
                >
                  <Paperclip className="w-4 h-4" />
                </button>

                <textarea
                  rows={1}
                  value={text}
                  onChange={(e) => handleTyping(e.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && window.innerWidth >= 768) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder={
                    isInternalNote
                      ? 'Catatan internal admin...'
                      : 'Balas atas nama Bot Humas...'
                  }
                  className="flex-1 resize-none max-h-28 px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
                />

                <button
                  type="submit"
                  disabled={sending || (!text.trim() && files.length === 0)}
                  className={`p-2.5 sm:px-4 rounded-lg font-medium text-sm flex items-center gap-1.5 text-white disabled:opacity-50 shrink-0 cursor-pointer ${
                    isInternalNote
                      ? 'bg-amber-600 hover:bg-amber-500'
                      : 'bg-indigo-600 hover:bg-indigo-500'
                  }`}
                  aria-label="Kirim pesan"
                >
                  <Send className="w-4 h-4" />
                  <span className="hidden sm:inline">Kirim</span>
                </button>
              </div>
            </form>
          </>
        )}
      </div>

      {/* RIGHT COLUMN: Desktop Info Panel */}
      {activeConv && (
        <div className="hidden lg:block w-72 shrink-0 border-l border-slate-800 bg-slate-900/50 p-4 overflow-y-auto">
          {infoPanelContent}
        </div>
      )}

      {/* MOBILE / TABLET INFO DRAWER */}
      {showInfoDrawer && activeConv && (
        <div className="lg:hidden fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-black/60" onClick={() => setShowInfoDrawer(false)} />
          <div className="relative z-10 w-80 max-w-[85vw] h-full bg-slate-900 border-l border-slate-800 p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800">
              <span className="font-semibold text-sm text-white">Info & Aksi Cepat</span>
              <button
                onClick={() => setShowInfoDrawer(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {infoPanelContent}
          </div>
        </div>
      )}

      {/* Lightbox Zoom */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4 cursor-zoom-out"
        >
          <img src={lightboxUrl} alt="" className="max-w-full max-h-full rounded-xl" />
        </div>
      )}

      {/* Warning Modal */}
      {showWarnModal && activeConv && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleIssueWarning}
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white text-sm">
                Kirim Warning ke {activeConv.discord_username}
              </h3>
              <button type="button" onClick={() => setShowWarnModal(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Tingkat Peringatan</label>
              <select
                value={warnLevel}
                onChange={(e) => setWarnLevel(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
              >
                <option value={1}>Level 1 — Teguran Ringan</option>
                <option value={2}>Level 2 — Peringatan Keras</option>
                <option value={3}>Level 3 — Peringatan Final / Strike</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Alasan Pelanggaran</label>
              <textarea
                rows={3}
                required
                value={warnReason}
                onChange={(e) => setWarnReason(e.target.value)}
                placeholder="Jelaskan pelanggaran secara jelas dan sopan..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowWarnModal(false)}
                className="px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={warnLoading}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium cursor-pointer"
              >
                {warnLoading ? 'Mengirim...' : 'Kirim Warning via Bot'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* New Chat Modal */}
      {showNewChat && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white text-sm">
                Mulai Chat Anonim ke Member / Partner
              </h3>
              <button onClick={() => setShowNewChat(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Kategori Pesan</label>
              <select
                value={newChatCategory}
                onChange={(e) => setNewChatCategory(e.target.value as ConversationCategory)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
              >
                <option value="general">📩 Info Personal / Umum</option>
                <option value="warning">⚠️ Pelanggaran / Teguran</option>
                <option value="reward">🎁 Info Hadiah / Giveaway</option>
                <option value="benefit">✨ Reminder Benefit / Custom Role</option>
                <option value="partnership">🤝 Partnership</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Cari Member Server</label>
              <input
                value={memberQuery}
                onChange={(e) => void searchMembers(e.target.value)}
                placeholder="Ketik nama member..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
              />
              {memberResults.length > 0 && (
                <div className="mt-2 max-h-40 overflow-y-auto divide-y divide-slate-800 border border-slate-800 rounded-lg">
                  {memberResults.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => void startConversation(m.id, m.username, m.avatar)}
                      className="w-full flex items-center gap-2.5 p-2 hover:bg-slate-800 text-left cursor-pointer"
                    >
                      <img src={m.avatar} alt="" loading="lazy" className="w-7 h-7 rounded-full" />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-white truncate">
                          {m.displayName}
                        </div>
                        <div className="text-[11px] text-slate-400">@{m.username}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 space-y-2">
              <p className="text-xs text-slate-400">Atau masukkan Discord User ID manual:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  value={manualUserId}
                  onChange={(e) => setManualUserId(e.target.value)}
                  placeholder="Discord User ID"
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                />
                <input
                  value={manualUsername}
                  onChange={(e) => setManualUsername(e.target.value)}
                  placeholder="Nama / Username"
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                />
              </div>
              <button
                disabled={!manualUserId.trim()}
                onClick={() => void startConversation(manualUserId, manualUsername || manualUserId)}
                className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
              >
                Buka Roomchat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
