import type { Server as SocketIOServer } from 'socket.io';
import type { AnonMessage, AnonSessionPublic, ChatMessage, Conversation } from './types.js';

let ioInstance: SocketIOServer | null = null;

// Track active admins viewing/typing per conversationId
const conversationViewers = new Map<number, Map<string, { username: string; name: string; typing: boolean }>>();

export function setSocketIO(io: SocketIOServer): void {
  ioInstance = io;
}

export function getSocketIO(): SocketIOServer | null {
  return ioInstance;
}

export function emitNewMessage(conversation: Conversation, message: ChatMessage): void {
  ioInstance?.emit('message:new', { conversation, message });
}

export function emitConversationUpdated(conversation: Conversation): void {
  ioInstance?.emit('conversation:updated', conversation);
}

export function emitAnonMessage(session: AnonSessionPublic, message: AnonMessage): void {
  ioInstance?.emit('anon:message', { session, message });
}

export function emitAnonSessionUpdated(session: AnonSessionPublic): void {
  ioInstance?.emit('anon:updated', session);
}

export function emitNotification(payload: {
  type: 'dm' | 'anon' | 'aspiration' | 'partner_leave' | 'rsvp' | 'survey' | 'broadcast';
  title: string;
  body: string;
  conversationId?: number;
}): void {
  ioInstance?.emit('notification:new', payload);
}

export function emitBroadcastProgress(payload: {
  broadcastId: string;
  total: number;
  sent: number;
  failed: number;
  done: boolean;
  currentPartner?: string;
}): void {
  ioInstance?.emit('broadcast:progress', payload);
}

export function setViewerState(
  conversationId: number,
  socketId: string,
  admin: { username: string; name: string },
  typing: boolean
): void {
  if (!conversationViewers.has(conversationId)) {
    conversationViewers.set(conversationId, new Map());
  }
  conversationViewers.get(conversationId)!.set(socketId, { ...admin, typing });
  broadcastPresence(conversationId);
}

export function removeViewerFromAll(socketId: string): void {
  for (const [convId, map] of conversationViewers.entries()) {
    if (map.delete(socketId)) {
      if (map.size === 0) conversationViewers.delete(convId);
      broadcastPresence(convId);
    }
  }
}

export function leaveConversation(conversationId: number, socketId: string): void {
  const map = conversationViewers.get(conversationId);
  if (map && map.delete(socketId)) {
    if (map.size === 0) conversationViewers.delete(conversationId);
    broadcastPresence(conversationId);
  }
}

function broadcastPresence(conversationId: number): void {
  const map = conversationViewers.get(conversationId);
  const viewers = map ? Array.from(map.values()) : [];
  ioInstance?.emit('conversation:presence', { conversationId, viewers });
}
