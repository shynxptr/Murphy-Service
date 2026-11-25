import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import {
  FileText,
  Hash,
  Image as ImageIcon,
  Paperclip,
  RefreshCw,
  Send,
  X,
} from 'lucide-react';
import { apiFetch } from '../api';
import type { ChannelPost, GuildChannelOption } from '../types';

export function ChannelsView() {
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [posts, setPosts] = useState<ChannelPost[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);

  const [channelId, setChannelId] = useState('');
  const [useEmbed, setUseEmbed] = useState(false);
  const [embedTitle, setEmbedTitle] = useState('');
  const [embedColor, setEmbedColor] = useState('#6366f1');
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadChannels() {
    setLoadingChannels(true);
    try {
      const res = await apiFetch<{ channels: GuildChannelOption[] }>('/api/channels');
      setChannels(res.channels);
      if (!channelId && res.channels.length > 0) {
        setChannelId(res.channels[0].id);
      }
    } finally {
      setLoadingChannels(false);
    }
  }

  async function loadHistory() {
    const res = await apiFetch<{ posts: ChannelPost[] }>('/api/channels/history');
    setPosts(res.posts);
  }

  useEffect(() => {
    void loadChannels();
    void loadHistory();
  }, []);

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted: File[] = [];
    for (const item of e.clipboardData.items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) pasted.push(f);
      }
    }
    if (pasted.length > 0) {
      setFiles((prev) => [...prev, ...pasted].slice(0, 4));
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!channelId || (!content.trim() && files.length === 0)) return;
    setSending(true);
    setFeedback(null);
    try {
      const form = new FormData();
      form.append('channel_id', channelId);
      form.append('content', content);
      form.append('use_embed', String(useEmbed));
      if (useEmbed) {
        form.append('embed_title', embedTitle);
        form.append('embed_color', embedColor);
      }
      for (const f of files) {
        form.append('files', f);
      }
      await apiFetch('/api/channels/send', {
        method: 'POST',
        body: form,
      });
      setContent('');
      setEmbedTitle('');
      setFiles([]);
      setFeedback({ type: 'ok', text: 'Pesan berhasil dikirim ke channel Discord!' });
      await loadHistory();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal mengirim pesan ke channel.',
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Hash className="w-5 h-5 text-indigo-400" />
          Kirim Pesan ke Channel Server
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Kirim pengumuman, info, atau poster/gambar langsung ke channel Discord atas nama Bot Humas.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        {/* Composer */}
        <form
          onSubmit={handleSend}
          className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4"
        >
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-slate-400">Pilih Channel Tujuan *</label>
              <button
                type="button"
                onClick={() => void loadChannels()}
                className="text-[11px] text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${loadingChannels ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              required
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
            >
              {channels.length === 0 && (
                <option value="">
                  (Bot offline / belum ada channel — cek DISCORD_TOKEN & DISCORD_GUILD_ID)
                </option>
              )}
              {channels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  #{ch.name} {ch.parentName ? `(${ch.parentName})` : ''}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={useEmbed}
              onChange={(e) => setUseEmbed(e.target.checked)}
            />
            Bungkus sebagai Embed rapi (opsional)
          </label>

          {useEmbed && (
            <div className="grid grid-cols-4 gap-2">
              <input
                value={embedTitle}
                onChange={(e) => setEmbedTitle(e.target.value)}
                placeholder="Judul Embed (opsional)"
                className="col-span-3 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
              />
              <input
                type="color"
                value={embedColor}
                onChange={(e) => setEmbedColor(e.target.value)}
                title="Warna aksen Embed"
                className="w-full h-9 bg-slate-950 border border-slate-800 rounded-lg p-1 cursor-pointer"
              />
            </div>
          )}

          <div>
            <label className="text-xs text-slate-400 block mb-1">Isi Pesan</label>
            <textarea
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onPaste={handlePaste}
              placeholder="Tulis pengumuman atau informasi di sini... (mendukung format Markdown Discord & Ctrl+V paste gambar)"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Attachments */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
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
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
              >
                <Paperclip className="w-3.5 h-3.5" />
                Lampirkan Gambar / PDF (maks 4)
              </button>
              <span className="text-[11px] text-slate-500">Maks 8MB per file</span>
            </div>

            {files.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {files.map((f, idx) => (
                  <div
                    key={`${f.name}-${idx}`}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200"
                  >
                    <ImageIcon className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="max-w-36 truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-slate-400 hover:text-red-400 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {feedback && (
            <div
              className={`p-3 rounded-lg text-xs border ${
                feedback.type === 'ok'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-red-500/10 border-red-500/30 text-red-300'
              }`}
            >
              {feedback.text}
            </div>
          )}

          <button
            type="submit"
            disabled={sending || !channelId || (!content.trim() && files.length === 0)}
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Send className="w-4 h-4" />
            {sending ? 'Mengirim ke Discord...' : 'Kirim ke Channel'}
          </button>
        </form>

        {/* History */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <h2 className="text-sm font-semibold text-white">Riwayat Postingan Channel</h2>
          {posts.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">
              Belum ada pesan channel yang dikirim dari web.
            </p>
          ) : (
            <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
              {posts.map((p) => (
                <div
                  key={p.id}
                  className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-indigo-300">#{p.channel_name}</span>
                    <span className="text-[11px] text-slate-500">
                      Oleh {p.sent_by} • {new Date(p.created_at + 'Z').toLocaleString('id-ID')}
                    </span>
                  </div>
                  {p.embed_title && (
                    <div className="font-semibold text-white">{p.embed_title}</div>
                  )}
                  {p.content && (
                    <p className="text-slate-200 whitespace-pre-wrap break-words">{p.content}</p>
                  )}
                  {p.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {p.attachments.map((att) =>
                        att.mimeType.startsWith('image/') ? (
                          <img
                            key={att.filename}
                            src={att.url}
                            alt={att.originalName}
                            onClick={() => setLightboxUrl(att.url)}
                            className="h-24 rounded-lg border border-slate-800 cursor-zoom-in"
                          />
                        ) : (
                          <a
                            key={att.filename}
                            href={att.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-indigo-400 underline"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            {att.originalName}
                          </a>
                        )
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-6 cursor-zoom-out"
        >
          <img src={lightboxUrl} alt="" className="max-w-full max-h-full rounded-xl shadow-2xl" />
        </div>
      )}
    </div>
  );
}

