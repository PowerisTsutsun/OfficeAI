/**
 * API client — all requests go through this module.
 * Handles: auth headers, token refresh, error normalization, base URL.
 * In production (Tauri), requests are proxied through the Rust layer.
 */

import type {
  AIProvider,
  ChatFolder,
  ChatMessageData,
  ChatSession,
  PromptTemplate,
  TokenPair,
  User,
  UserPreferences,
  UserQuota,
  UserSession,
  StreamEvent,
} from '@/types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';
const DEVICE_ID_KEY = 'device_id';

// Stable device ID persisted to localStorage
function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// ── Token storage (Tauri: use OS keychain via invoke; web: memory only) ──────
let _accessToken: string | null = null;
let _refreshToken: string | null = null;

export function setTokens(pair: TokenPair): void {
  _accessToken = pair.accessToken;
  _refreshToken = pair.refreshToken;
  // In Tauri production: store refresh token in OS keychain
  // invoke('store_refresh_token', { token: pair.refreshToken })
  sessionStorage.setItem('rt', pair.refreshToken); // dev fallback
}

export function clearTokens(): void {
  _accessToken = null;
  _refreshToken = null;
  sessionStorage.removeItem('rt');
}

export function getAccessToken(): string | null {
  return _accessToken;
}

export function loadStoredTokens(): void {
  const rt = sessionStorage.getItem('rt');
  if (rt) _refreshToken = rt;
}

function mapChatSession(raw: any): ChatSession {
  return {
    id: raw.id,
    title: raw.title ?? null,
    provider: raw.provider,
    model: raw.model,
    isPinned: raw.is_pinned ?? raw.isPinned ?? false,
    isEphemeral: raw.is_ephemeral ?? raw.isEphemeral ?? false,
    tags: raw.tags ?? [],
    folderId: raw.folder_id ?? raw.folderId ?? null,
    totalTokensIn: raw.total_tokens_in ?? raw.totalTokensIn ?? 0,
    totalTokensOut: raw.total_tokens_out ?? raw.totalTokensOut ?? 0,
    messageCount: raw.message_count ?? raw.messageCount ?? 0,
    lastMessageAt: raw.last_message_at ?? raw.lastMessageAt ?? null,
    createdAt: raw.created_at ?? raw.createdAt,
    updatedAt: raw.updated_at ?? raw.updatedAt,
  };
}

// ── Core fetch wrapper ────────────────────────────────────────────────────────

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(detail);
    this.name = 'ApiError';
  }
}

let _isRefreshing = false;
let _refreshQueue: Array<(token: string | null) => void> = [];

async function refreshAccessToken(): Promise<string | null> {
  if (!_refreshToken) return null;

  if (_isRefreshing) {
    return new Promise((resolve) => {
      _refreshQueue.push(resolve);
    });
  }

  _isRefreshing = true;
  try {
    const res = await fetch(`${BASE_URL}/auth/token/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': getDeviceId(),
      },
      body: JSON.stringify({ refresh_token: _refreshToken }),
    });

    if (!res.ok) {
      clearTokens();
      _refreshQueue.forEach((cb) => cb(null));
      _refreshQueue = [];
      return null;
    }

    const data = await res.json();
    setTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    });

    _refreshQueue.forEach((cb) => cb(data.access_token));
    _refreshQueue = [];
    return data.access_token;
  } finally {
    _isRefreshing = false;
  }
}

async function request<T>(
  method: HttpMethod,
  path: string,
  options: {
    body?: unknown;
    params?: Record<string, string | number | boolean | undefined>;
    signal?: AbortSignal;
    retry?: boolean;
  } = {},
): Promise<T> {
  const { body, params, signal, retry = true } = options;

  let url = `${BASE_URL}${path}`;
  if (params) {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) search.set(k, String(v));
    }
    const qs = search.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    'X-Device-Id': getDeviceId(),
    'X-Device-Name': navigator.platform ?? 'Desktop',
  };
  if (_accessToken) headers['Authorization'] = `Bearer ${_accessToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  // Auto-refresh on 401
  if (response.status === 401 && retry) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return request<T>(method, path, { ...options, retry: false });
    }
    throw new ApiError(401, 'Session expired. Please log in again.');
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const err = await response.json();
      detail = err.detail ?? detail;
    } catch {}
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

// ── Streaming (SSE) ───────────────────────────────────────────────────────────

export async function* streamMessage(
  sessionId: string,
  content: string,
  temperature = 0.7,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const response = await fetch(
    `${BASE_URL}/chat/sessions/${sessionId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${_accessToken}`,
        'X-Device-Id': getDeviceId(),
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ content, temperature }),
      signal,
    },
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Stream failed' }));
    throw new ApiError(response.status, err.detail);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const event: StreamEvent = JSON.parse(line.slice(6));
          yield event;
        } catch {}
      }
    }
  }
}

// ── Auth endpoints ─────────────────────────────────────────────────────────────

export const auth = {
  requestMagicLink: (email: string) =>
    request<{ message: string }>('POST', '/auth/magic-link', { body: { email } }),

  verifyMagicLink: (token: string, deviceId?: string) =>
    request<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
    }>('POST', '/auth/magic-link/verify', {
      body: { token, device_id: deviceId ?? getDeviceId() },
    }),

  logout: () => request<void>('POST', '/auth/logout'),

  getSessions: () => request<UserSession[]>('GET', '/auth/sessions'),

  revokeSession: (sessionId: string) =>
    request<void>('DELETE', `/auth/sessions/${sessionId}`),

  devLogin: (username: string, password: string) =>
    request<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
    }>('POST', '/auth/dev-login', { body: { username, password } }),
};

// ── User endpoints ─────────────────────────────────────────────────────────────

export const user = {
  getMe: () => request<User>('GET', '/user/me'),
  updateMe: (data: Partial<User & UserPreferences>) =>
    request<User>('PATCH', '/user/me', { body: data }),
  getUsage: () => request<UserQuota>('GET', '/user/me/usage'),
  getQuota: () => request<UserQuota>('GET', '/user/me/quota'),
};

// ── Models endpoint ────────────────────────────────────────────────────────────

export const models = {
  list: () => request<AIProvider[]>('GET', '/models'),
};

// ── Chat endpoints ─────────────────────────────────────────────────────────────

export const chat = {
  listSessions: async (params?: { limit?: number; offset?: number; search?: string }) => {
    const sessions = await request<any[]>('GET', '/chat/sessions', { params });
    return sessions.map(mapChatSession);
  },

  createSession: async (data: {
    provider: string;
    model: string;
    title?: string;
    isEphemeral?: boolean;
    systemPrompt?: string;
    tags?: string[];
  }) => {
    const session = await request<any>('POST', '/chat/sessions', {
      body: {
        provider: data.provider,
        model: data.model,
        title: data.title,
        is_ephemeral: data.isEphemeral ?? false,
        system_prompt: data.systemPrompt,
        tags: data.tags ?? [],
      },
    });
    return mapChatSession(session);
  },

  getSession: async (id: string) => {
    const session = await request<any>('GET', `/chat/sessions/${id}`);
    return mapChatSession(session);
  },

  updateSession: async (id: string, data: Partial<ChatSession>) => {
    const session = await request<any>('PATCH', `/chat/sessions/${id}`, {
      body: {
        title: data.title,
        is_pinned: data.isPinned,
        tags: data.tags,
        folder_id: data.folderId,
        provider: data.provider,
        model: data.model,
      },
    });
    return mapChatSession(session);
  },

  deleteSession: (id: string) =>
    request<void>('DELETE', `/chat/sessions/${id}`),

  getMessages: (sessionId: string, params?: { limit?: number }) =>
    request<ChatMessageData[]>('GET', `/chat/sessions/${sessionId}/messages`, { params }),

  getFolders: () => request<ChatFolder[]>('GET', '/chat/folders'),

  createFolder: (name: string, color?: string) =>
    request<ChatFolder>('POST', '/chat/folders', { body: { name, color } }),
};

// ── Templates ─────────────────────────────────────────────────────────────────

export const templates = {
  list: () => request<PromptTemplate[]>('GET', '/templates'),
  create: (data: Partial<PromptTemplate>) =>
    request<PromptTemplate>('POST', '/templates', { body: data }),
  update: (id: string, data: Partial<PromptTemplate>) =>
    request<PromptTemplate>('PATCH', `/templates/${id}`, { body: data }),
  delete: (id: string) => request<void>('DELETE', `/templates/${id}`),
};
