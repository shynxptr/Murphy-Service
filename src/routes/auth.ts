import { Router } from 'express';
import {
  AUTH_COOKIE_NAME,
  requireAuth,
  signSessionToken,
  verifyCredentials,
  type AuthenticatedRequest,
} from '../auth.js';
import { logAudit } from '../db.js';

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: 'Username dan password wajib diisi.' });
    return;
  }

  const user = await verifyCredentials(username, password);
  if (!user) {
    res.status(401).json({ error: 'Username atau password salah.' });
    return;
  }

  const token = signSessionToken(user);
  logAudit({
    admin_username: user.username,
    admin_name: user.name,
    admin_role: user.role,
    action: 'login',
    target: 'Web Panel',
    details: 'Login berhasil',
  });
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json({ user, token });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});
