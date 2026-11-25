import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { AUTH_COOKIE_NAME, verifySessionToken } from './auth.js';
import { startDiscordBot } from './bot.js';
import { config } from './config.js';
import './db.js';
import {
  leaveConversation,
  removeViewerFromAll,
  setSocketIO,
  setViewerState,
} from './realtime.js';
import { anonChatsRouter } from './routes/anonChats.js';
import { auditLogsRouter } from './routes/auditLogs.js';
import { authRouter } from './routes/auth.js';
import { channelsRouter } from './routes/channels.js';
import { communityRouter } from './routes/community.js';
import { conversationsRouter } from './routes/conversations.js';
import { customRolesRouter } from './routes/customRoles.js';
import { partnersRouter } from './routes/partners.js';
import { quickContactsRouter } from './routes/quickContacts.js';
import { templatesRouter } from './routes/templates.js';
import { uploadsRouter } from './routes/uploads.js';
import { warningsRouter } from './routes/warnings.js';

const app = express();
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: true,
    credentials: true,
  },
});

setSocketIO(io);

// Authenticate Socket.IO connections using the same HTTP-only session cookie
function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      result[k] = v;
    }
  }
  return result;
}

io.use((socket, next) => {
  const cookies = parseCookieHeader(socket.handshake.headers.cookie);
  const token = cookies[AUTH_COOKIE_NAME] || (socket.handshake.auth?.token as string | undefined);
  if (!token) {
    next(new Error('Unauthorized'));
    return;
  }
  const user = verifySessionToken(token);
  if (!user) {
    next(new Error('Unauthorized'));
    return;
  }
  socket.data.user = user;
  next();
});

io.on('connection', (socket) => {
  const user = socket.data.user as { username: string; name: string };

  socket.on('conversation:join', (conversationId: number) => {
    setViewerState(Number(conversationId), socket.id, user, false);
  });

  socket.on('conversation:typing', (payload: { conversationId: number; typing: boolean }) => {
    setViewerState(Number(payload.conversationId), socket.id, user, Boolean(payload.typing));
  });

  socket.on('conversation:leave', (conversationId: number) => {
    leaveConversation(Number(conversationId), socket.id);
  });

  socket.on('disconnect', () => {
    removeViewerFromAll(socket.id);
  });
});

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/anon-chats', anonChatsRouter);
app.use('/api/audit-logs', auditLogsRouter);
app.use('/api/channels', channelsRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/custom-roles', customRolesRouter);
app.use('/api/partners', partnersRouter);
app.use('/api/quick-contacts', quickContactsRouter);
app.use('/api/warnings', warningsRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/community', communityRouter);
app.use('/api/uploads', uploadsRouter);

// Multer & global error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('[Server Error]', err.message);
    res.status(400).json({ error: err.message || 'Terjadi kesalahan pada server.' });
  }
);

// Serve built frontend in production
const webDistDir = path.resolve('./web/dist');
if (fs.existsSync(webDistDir)) {
  app.use(express.static(webDistDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(webDistDir, 'index.html'));
  });
}

server.listen(config.port, () => {
  console.log(`[Web] Humas Desk Control Panel berjalan di http://localhost:${config.port}`);
  console.log(`[Auth] ${config.adminAccounts.length} akun admin dimuat dari .env`);
  void startDiscordBot();
});
