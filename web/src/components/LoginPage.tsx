import { useState, type FormEvent } from 'react';
import { Shield, Lock, User } from 'lucide-react';
import { apiFetch } from '../api';
import type { AuthUser } from '../types';

interface Props {
  onLogin: (user: AuthUser) => void;
}

export function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      onLogin(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal login.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center mb-4">
            <Shield className="w-7 h-7 text-indigo-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">Humas Desk</h1>
          <p className="text-sm text-slate-400 mt-1">
            Control Panel Tertutup — Tim Humas Discord
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Username Admin
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                placeholder="Masukkan username dari .env"
                className="w-full pl-10 pr-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full pl-10 pr-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-sm transition cursor-pointer"
          >
            {loading ? 'Memverifikasi...' : 'Masuk ke Humas Desk'}
          </button>
        </form>

        <p className="text-xs text-slate-500 text-center mt-6">
          Akun dikelola secara tertutup melalui konfigurasi server (.env).
        </p>
      </div>
    </div>
  );
}
