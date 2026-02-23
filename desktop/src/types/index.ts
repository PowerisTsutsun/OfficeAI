// ── Auth / User ────────────────────────────────────────────────────────────────

export type UserRole = 'user' | 'admin' | 'super_admin';
export type Theme = 'light' | 'dark' | 'system';
export type AccentColor = 'blue' | 'purple' | 'green' | 'orange' | 'pink';

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: UserRole;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface UserPreferences {
  preferredProvider: string | null;
  preferredModel: string | null;
  theme: Theme;
  accentColor: AccentColor;
  fontSize: number;
  reducedMotion: boolean;
  compactMode: boolean;
  sidebarWidth: number;
}

export interface UserQuota {
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
  contextWindowLimit: number;
  dailyTokensUsed: number;
  monthlyTokensUsed: number;
  dailyResetAt: string;
  monthlyResetAt: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface UserSession {
  id: string;
  deviceName: string | null;
  platform: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  isCurrent: boolean;
}

// ── AI Models ─────────────────────────────────────────────────────────────────

export interface AIProvider {
  id: string;
  name: string;
  displayName: string;
  isEnabled: boolean;
  models: AIModel[];
}

export interface AIModel {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number | null;
  supportsVision: boolean;
  supportsTools: boolean;
  isEnabled: boolean;
  isBeta: boolean;
  sortOrder: number;
}

// ── Chat ──────────────────────────────────────────────────────────────────────

export interface ChatFolder {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  title: string | null;
  provider: string;
  model: string;
  isPinned: boolean;
  isEphemeral: boolean;
  privacyMode: PrivacyMode;
  tags: string[];
  folderId: string | null;
  totalTokensIn: number;
  totalTokensOut: number;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MessageRole = 'user' | 'assistant' | 'system';
export type PrivacyMode = 'true_private' | 'local' | 'masked_private';

export interface ChatMessageData {
  id: string;
  role: MessageRole;
  content: string;
  tokensIn: number;
  tokensOut: number;
  provider: string | null;
  model: string | null;
  finishReason: string | null;
  createdAt: string;
  // UI-only state
  isStreaming?: boolean;
  streamingContent?: string;
  hasError?: boolean;
  errorMessage?: string;
}

// SSE event types from the streaming endpoint
export type StreamEventType = 'start' | 'delta' | 'done' | 'error';

export interface StreamEvent {
  type: StreamEventType;
  delta?: string;
  sessionId?: string;
  tokensIn?: number;
  tokensOut?: number;
  finishReason?: string;
  error?: string;
}

// ── Prompt Templates ──────────────────────────────────────────────────────────

export interface PromptTemplate {
  id: string;
  userId: string | null;
  title: string;
  description: string | null;
  content: string;
  tags: string[];
  isCompanyTemplate: boolean;
  isPublic: boolean;
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

// ── UI State ──────────────────────────────────────────────────────────────────

export type PanelState = 'open' | 'closed';

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  shortcut?: string;
  group: 'actions' | 'chats' | 'models' | 'templates' | 'settings';
  action: () => void;
}

// ── API Response wrappers ─────────────────────────────────────────────────────

export interface ApiError {
  detail: string;
  status: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
