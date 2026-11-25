import { io, type Socket } from 'socket.io-client';

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = isFormData
    ? {}
    : { 'Content-Type': 'application/json' };

  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      ...headers,
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`) as Error & {
      code?: string;
      data?: unknown;
    };
    err.code = data.code;
    err.data = data;
    throw err;
  }
  return data as T;
}

let socket: Socket | null = null;

export function connectSocket(): Socket {
  if (!socket) {
    socket = io({
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
