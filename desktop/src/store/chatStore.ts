import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import * as api from '@/lib/api';
import type { ChatMessageData, ChatSession, ChatFolder, AIProvider } from '@/types';

interface ChatState {
  // Sessions
  sessions: ChatSession[];
  folders: ChatFolder[];
  activeSessionId: string | null;
  activeSession: ChatSession | null;

  // Messages (keyed by session ID)
  messagesBySession: Record<string, ChatMessageData[]>;

  // Loading states
  sessionsLoading: boolean;
  messagesLoading: boolean;
  isSending: boolean;
  streamingSessionId: string | null;

  // Models
  providers: AIProvider[];
  selectedProvider: string;
  selectedModel: string;

  // Error
  error: string | null;
}

interface ChatActions {
  // Session management
  loadSessions: () => Promise<void>;
  loadFolders: () => Promise<void>;
  createSession: (data: {
    provider?: string;
    model?: string;
    isEphemeral?: boolean;
    systemPrompt?: string;
  }) => Promise<ChatSession>;
  selectSession: (id: string | null) => Promise<void>;
  updateSession: (id: string, data: Partial<ChatSession>) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;

  // Messages
  loadMessages: (sessionId: string) => Promise<void>;
  sendMessage: (content: string, temperature?: number) => Promise<void>;
  cancelStream: () => void;

  // Models
  loadProviders: () => Promise<void>;
  setModel: (provider: string, model: string) => void;

  clearError: () => void;
}

let abortController: AbortController | null = null;

export const useChatStore = create<ChatState & ChatActions>()(
  immer((set, get) => ({
    sessions: [],
    folders: [],
    activeSessionId: null,
    activeSession: null,
    messagesBySession: {},
    sessionsLoading: false,
    messagesLoading: false,
    isSending: false,
    streamingSessionId: null,
    providers: [],
    selectedProvider: 'gemini',
    selectedModel: 'gemini-3-flash-preview',
    error: null,

    loadSessions: async () => {
      set((s) => { s.sessionsLoading = true; });
      try {
        const sessions = await api.chat.listSessions({ limit: 100 });
        set((s) => { s.sessions = sessions; });
      } catch (e: any) {
        set((s) => { s.error = e.detail ?? e.message; });
      } finally {
        set((s) => { s.sessionsLoading = false; });
      }
    },

    loadFolders: async () => {
      const folders = await api.chat.getFolders();
      set((s) => { s.folders = folders; });
    },

    createSession: async ({ provider, model, isEphemeral, systemPrompt } = {}) => {
      const { selectedProvider, selectedModel } = get();
      const session = await api.chat.createSession({
        provider: provider ?? selectedProvider,
        model: model ?? selectedModel,
        isEphemeral,
        systemPrompt,
      });
      set((s) => { s.sessions.unshift(session); });
      await get().selectSession(session.id);
      return session;
    },

    selectSession: async (id) => {
      set((s) => {
        s.activeSessionId = id;
        s.activeSession = id ? s.sessions.find((s2) => s2.id === id) ?? null : null;
      });

      if (id && !get().messagesBySession[id]) {
        await get().loadMessages(id);
      }
    },

    updateSession: async (id, data) => {
      const updated = await api.chat.updateSession(id, data);
      set((s) => {
        const idx = s.sessions.findIndex((s2) => s2.id === id);
        if (idx !== -1) s.sessions[idx] = updated;
        if (s.activeSessionId === id) s.activeSession = updated;
      });
    },

    deleteSession: async (id) => {
      await api.chat.deleteSession(id);
      set((s) => {
        s.sessions = s.sessions.filter((s2) => s2.id !== id);
        if (s.activeSessionId === id) {
          s.activeSessionId = null;
          s.activeSession = null;
        }
        delete s.messagesBySession[id];
      });
    },

    loadMessages: async (sessionId) => {
      set((s) => { s.messagesLoading = true; });
      try {
        const messages = await api.chat.getMessages(sessionId);
        set((s) => { s.messagesBySession[sessionId] = messages; });
      } catch (e: any) {
        set((s) => { s.error = e.detail ?? e.message; });
      } finally {
        set((s) => { s.messagesLoading = false; });
      }
    },

    sendMessage: async (content, temperature = 0.7) => {
      const { activeSessionId } = get();
      if (!activeSessionId) return;

      abortController = new AbortController();

      // Optimistic: append user message immediately
      const optimisticId = `opt_${Date.now()}`;
      const userMsg: ChatMessageData = {
        id: optimisticId,
        role: 'user',
        content,
        tokensIn: 0,
        tokensOut: 0,
        provider: null,
        model: null,
        finishReason: null,
        createdAt: new Date().toISOString(),
      };

      const assistantId = `stream_${Date.now()}`;
      const assistantMsg: ChatMessageData = {
        id: assistantId,
        role: 'assistant',
        content: '',
        tokensIn: 0,
        tokensOut: 0,
        provider: get().activeSession?.provider ?? null,
        model: get().activeSession?.model ?? null,
        finishReason: null,
        createdAt: new Date().toISOString(),
        isStreaming: true,
        streamingContent: '',
      };

      set((s) => {
        if (!s.messagesBySession[activeSessionId]) {
          s.messagesBySession[activeSessionId] = [];
        }
        s.messagesBySession[activeSessionId].push(userMsg, assistantMsg);
        s.isSending = true;
        s.streamingSessionId = activeSessionId;
      });

      try {
        for await (const event of api.streamMessage(
          activeSessionId,
          content,
          temperature,
          abortController.signal,
        )) {
          if (event.type === 'delta' && event.delta) {
            set((s) => {
              const msgs = s.messagesBySession[activeSessionId];
              const idx = msgs?.findLastIndex((m) => m.id === assistantId);
              if (idx !== undefined && idx !== -1 && msgs) {
                msgs[idx].streamingContent =
                  (msgs[idx].streamingContent ?? '') + event.delta!;
              }
            });
          } else if (event.type === 'done') {
            set((s) => {
              const msgs = s.messagesBySession[activeSessionId];
              const idx = msgs?.findLastIndex((m) => m.id === assistantId);
              if (idx !== undefined && idx !== -1 && msgs) {
                msgs[idx].content = msgs[idx].streamingContent ?? '';
                msgs[idx].isStreaming = false;
                msgs[idx].tokensIn = event.tokensIn ?? 0;
                msgs[idx].tokensOut = event.tokensOut ?? 0;
                msgs[idx].finishReason = event.finishReason ?? null;
              }
            });
          } else if (event.type === 'error') {
            set((s) => {
              const msgs = s.messagesBySession[activeSessionId];
              const idx = msgs?.findLastIndex((m) => m.id === assistantId);
              if (idx !== undefined && idx !== -1 && msgs) {
                msgs[idx].isStreaming = false;
                msgs[idx].hasError = true;
                msgs[idx].errorMessage = event.error ?? 'Unknown error';
              }
            });
          }
        }

        // Reload session to get updated token counts
        const updated = await api.chat.getSession(activeSessionId);
        set((s) => {
          const idx = s.sessions.findIndex((s2) => s2.id === activeSessionId);
          if (idx !== -1) s.sessions[idx] = updated;
          if (s.activeSessionId === activeSessionId) s.activeSession = updated;
        });
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          set((s) => {
            const msgs = s.messagesBySession[activeSessionId];
            const idx = msgs?.findLastIndex((m) => m.id === assistantId);
            if (idx !== undefined && idx !== -1 && msgs) {
              msgs[idx].isStreaming = false;
              msgs[idx].hasError = true;
              msgs[idx].errorMessage = e.detail ?? e.message ?? 'Request failed';
            }
          });
        }
      } finally {
        set((s) => {
          s.isSending = false;
          s.streamingSessionId = null;
        });
        abortController = null;
      }
    },

    cancelStream: () => {
      abortController?.abort();
      set((s) => {
        s.isSending = false;
        s.streamingSessionId = null;
        const sid = s.activeSessionId;
        if (sid && s.messagesBySession[sid]) {
          const msgs = s.messagesBySession[sid];
          const last = msgs[msgs.length - 1];
          if (last?.isStreaming) {
            last.content = last.streamingContent ?? '';
            last.isStreaming = false;
            last.finishReason = 'cancelled';
          }
        }
      });
    },

    loadProviders: async () => {
      try {
        const providers = await api.models.list();
        set((s) => {
          s.providers = providers;
          // Set default to first available provider/model if current defaults aren't available
          if (providers.length > 0 && providers[0].models.length > 0) {
            const currentValid = providers.some((p) =>
              p.name === s.selectedProvider && p.models.some((m) => m.modelId === s.selectedModel)
            );
            if (!currentValid) {
              s.selectedProvider = providers[0].name;
              s.selectedModel = providers[0].models[0].modelId;
            }
          }
        });
      } catch {}
    },

    setModel: (provider, model) => {
      set((s) => {
        s.selectedProvider = provider;
        s.selectedModel = model;
      });
    },

    clearError: () => set((s) => { s.error = null; }),
  })),
);
