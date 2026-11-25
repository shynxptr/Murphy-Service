import {
  memo,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
} from 'react';
import {
  ArrowLeft,
  EyeOff,
  FileText,
  Image as ImageIcon,
  Lock,
  Paperclip,
  Send,
  X,
} from 'lucide-react';
import { apiFetch, connectSocket } from '../api';
import type { AnonMessage, AnonSessionPublic } from '../types';

const AnonBubble = memo(function AnonBubble({
  m,
  onZoom,
}: {
  m: AnonMessage;
  onZoom: (url: string) => void;
}) {
  if (m.sender_type === 'system') {
    return (
      <div className="flex justify-center">
        <div className="max-w-md text-center px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
          {m.content}
        </div>
      </div>
    );
  }

  const isAdmin = m.sender_type === 'admin';
  return (
    <div className={`flex flex-col ${isAdmin ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${
          isAdmin ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-100'
        }`}
      >
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
        {isAdmin ? `Oleh ${m.sender_label}` : m.sender_label} •{' '}
        {new Date(m.created_at + 'Z').toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
    </div>
  );
});

export function AnonChatView() {
  const [sessions, setSessions] = useState<AnonSessionPublic[]>([]);
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('open');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeSession, setActiveSession] = useState<AnonSessionPublic | null>(null);
  const [messages, setMessages] = useState<AnonMessage[]>([]);

  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadSessions() {
    const res = await apiFetch<{ sessions: AnonSessionPublic[] }>(
      `/api/anon-chats?status=${filter}`
    );
    setSessions(res.sessions);
  }

  async function loadDetail(id: number) {
    const res = await apiFetch<{ session: AnonSessionPublic; messages: AnonMessage[] }>(
      `/api/anon-chats/${id}`
    );
    setActiveSession(res.session);
    setMessages(res.messages);
    setSessions((prev) =>
      prev.map((s) => (s.id === res.session.id ? res.session : s))
    );
  }

  useEffect(() => {
    void loadSessions();
  }, [filter]);

  useEffect(() => {
    if (!selectedId) {
      setActiveSession(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId]);

  useEffect(() => {
    const socket = connectSocket();

    const onAnonMessage = ({
      session,
      message,
    }: {
      session: AnonSessionPublic;
      message: AnonMessage;
    }) => {
      setSessions((prev) => {
        const rest = prev.filter((s) => s.id !== session.id);
        return [session, ...rest];
      });
      if (session.id === selectedId) {
        setActiveSession(session);
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      }
    };

    const onAnonUpdated = (session: AnonSessionPublic) => {
      setSessions((prev) => prev.map((s) => (s.id === session.id ? session : s)));
      if (session.id === selectedId) setActiveSession(session);
    };

    socket.on('anon:message', onAnonMessage);
    socket.on('anon:updated', onAnonUpdated);
    return () => {
      socket.off('anon:message', onAnonMessage);
      socket.off('anon:updated', onAnonUpdated);
    };
  }, [selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages.length, selectedId]);

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted: File[] = [];
    for (const item of e.clipboardData.items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) pasted.push(f);
      }
    }
    if (pasted.length > 0) setFiles((prev) => [...prev, ...pasted].slice(0, 4));
  }

  async function handleSend(e?: FormEvent) {
    e?.preventDefault();
    if (!selectedId || (!text.trim() && files.length === 0) || sending) return;
    setErrorMsg('');
    setSending(true);
    try {
      const form = new FormData();
      form.append('content', text);
      for (const f of files) form.append('files', f);
      await apiFetch(`/api/anon-chats/${selectedId}/messages`, {
        method: 'POST',
        body: form,
      });
      setText('');
      setFiles([]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengirim balasan.');
    } finally {
      setSending(false);
    }
  }

  async function handleCloseSession() {
    if (!selectedId || !confirm('Tutup sesi chat anonim ini?')) return;
    await apiFetch(`/api/anon-chats/${selectedId}/close`, { method: 'POST' });
    await loadDetail(selectedId);
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* LEFT: Anon Session List */}
      <div
        className={`${
          selectedId ? 'hidden md:flex' : 'flex'
        } w-full md:w-80 shrink-0 border-r border-slate-800 bg-slate-900/60 flex-col`}
      >
        <div className="p-3 border-b border-slate-800 space-y-2.5">
          <div>
            <h2 className="font-semibold text-sm text-white flex items-center gap-1.5">
              <EyeOff className="w-4 h-4 text-violet-400" />
              Anon Chat (Curhat & Aduan)
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Member ketik <code>/anonchat</code> di Discord. Identitas 100% rahasia.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg text-xs">
            {(['open', 'closed', 'all'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={`py-1 rounded-md transition cursor-pointer ${
                  filter === t
                    ? 'bg-slate-800 text-white font-medium'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t === 'open' ? 'Aktif' : t === 'closed' ? 'Ditutup' : 'Semua'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
          {sessions.length === 0 && (
            <div className="p-6 text-center text-xs text-slate-500">
              Belum ada sesi chat anonim. Member bisa mulai lewat <code>/anonchat</code>.
            </div>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className={`w-full text-left p-3 hover:bg-slate-800/60 transition flex items-start gap-2.5 cursor-pointer ${
                selectedId === s.id ? 'bg-slate-800/90 border-l-2 border-violet-500' : ''
              }`}
            >
              <div className="w-9 h-9 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center shrink-0">
                <EyeOff className="w-4 h-4 text-violet-300" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-sm font-medium text-white truncate">{s.alias}</span>
                  {s.unread_count > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-violet-600 text-white">
                      {s.unread_count}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  {s.last_message_preview || 'Sesi dibuka'}
                </p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 truncate max-w-40">
                    {s.topic}
                  </span>
                  {s.status === 'closed' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                      Ditutup
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* RIGHT: Active Anon Roomchat */}
      <div
        className={`${
          selectedId ? 'flex' : 'hidden md:flex'
        } flex-1 flex-col bg-slate-950 min-w-0`}
      >
        {!activeSession ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-6 text-center">
            <EyeOff className="w-12 h-12 text-slate-700 mb-3" />
            <p className="text-sm font-medium text-slate-300">Pilih sesi Anon Chat</p>
            <p className="text-xs mt-1 max-w-sm">
              Identitas pengirim (username & Discord ID) disembunyikan total dari admin demi kenyamanan curhat & aduan.
            </p>
          </div>
        ) : (
          <>
            <div className="h-14 px-3 sm:px-4 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  onClick={() => setSelectedId(null)}
                  className="md:hidden p-1.5 -ml-1 rounded-lg text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="min-w-0">
                  <div className="font-semibold text-sm sm:text-base text-white truncate">
                    {activeSession.alias}
                  </div>
                  <div className="text-[11px] text-violet-300 truncate">
                    Topik: {activeSession.topic} • Identitas Tersembunyi
                  </div>
                </div>
              </div>

              {activeSession.status === 'open' && (
                <button
                  onClick={() => void handleCloseSession()}
                  className="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-red-500/20 text-slate-300 hover:text-red-300 border border-slate-700 cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5" />
                  Tutup Sesi
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-2.5">
              {messages.map((m) => (
                <AnonBubble key={m.id} m={m} onZoom={setLightboxUrl} />
              ))}
              <div ref={bottomRef} />
            </div>

            {errorMsg && (
              <div className="mx-3 sm:mx-4 mb-2 px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-xs text-red-300 flex items-center justify-between">
                <span>{errorMsg}</span>
                <button onClick={() => setErrorMsg('')} className="cursor-pointer">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {activeSession.status === 'closed' ? (
              <div className="p-3 border-t border-slate-800 bg-slate-900/50 text-center text-xs text-slate-500">
                Sesi chat anonim ini sudah ditutup.
              </div>
            ) : (
              <form
                onSubmit={handleSend}
                className="p-2.5 sm:p-3 border-t border-slate-800 bg-slate-900/60 shrink-0"
              >
                {files.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {files.map((f, idx) => (
                      <div
                        key={`${f.name}-${idx}`}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[11px] text-slate-200"
                      >
                        <ImageIcon className="w-3 h-3 text-violet-400" />
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
                    className="p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0 cursor-pointer"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>

                  <textarea
                    rows={1}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onPaste={handlePaste}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && window.innerWidth >= 768) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    placeholder={`Balas ${activeSession.alias} secara empatik...`}
                    className="flex-1 resize-none max-h-28 px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-violet-500"
                  />

                  <button
                    type="submit"
                    disabled={sending || (!text.trim() && files.length === 0)}
                    className="p-2.5 sm:px-4 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                    <span className="hidden sm:inline">Kirim</span>
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>

      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4 cursor-zoom-out"
        >
          <img src={lightboxUrl} alt="" className="max-w-full max-h-full rounded-xl" />
        </div>
      )}
    </div>
  );
}

