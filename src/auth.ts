import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { config, findAdminAccount } from './config.js';
import type { AdminRole, AuthUser } from './types.js';

export const AUTH_COOKIE_NAME = 'humas_session';

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export async function verifyCredentials(
  username: string,
  password: string
): Promise<AuthUser | null> {
  const account = findAdminAccount(username);
  if (!account) return null;

  let valid = false;
  if (account.password.startsWith('$2a$') || account.password.startsWith('$2b$') || account.password.startsWith('$2y$')) {
    valid = await bcrypt.compare(password, account.password);
  } else {
    valid = account.password === password;
  }

  if (!valid) return null;
  return {
    username: account.username,
    name: account.name,
    role: account.role,
  };
}

export function signSessionToken(user: AuthUser): string {
  return jwt.sign(user, config.jwtSecret, { expiresIn: '7d' });
}

export function verifySessionToken(token: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AuthUser;
    // Always re-verify account still exists in .env (instant revocation!)
    const activeAccount = findAdminAccount(decoded.username);
    if (!activeAccount) return null;
    return {
      username: activeAccount.username,
      name: activeAccount.name,
      role: activeAccount.role,
    };
  } catch {
    return null;
  }
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const token =
    req.cookies?.[AUTH_COOKIE_NAME] ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : undefined);

  if (!token) {
    res.status(401).json({ error: 'Silakan login terlebih dahulu.' });
    return;
  }

  const user = verifySessionToken(token);
  if (!user) {
    res.status(401).json({ error: 'Sesi tidak valid atau akun telah dinonaktifkan.' });
    return;
  }

  req.user = user;
  next();
}

export function requireRole(role: AdminRole) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (role === 'superadmin' && req.user.role !== 'superadmin') {
      res.status(403).json({ error: 'Akses khusus Super Admin (Ketua Humas).' });
      return;
    }
    next();
  };
}
