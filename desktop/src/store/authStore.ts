import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import * as api from '@/lib/api';
import type { User, UserPreferences, UserQuota } from '@/types';

interface AuthState {
  user: User | null;
  preferences: UserPreferences | null;
  quota: UserQuota | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

interface AuthActions {
  requestMagicLink: (email: string) => Promise<void>;
  verifyMagicLink: (token: string) => Promise<void>;
  devLogin: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
  updatePreferences: (prefs: Partial<UserPreferences>) => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState & AuthActions>()(
  immer((set, get) => ({
    user: null,
    preferences: null,
    quota: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,

    requestMagicLink: async (email) => {
      set((s) => { s.isLoading = true; s.error = null; });
      try {
        await api.auth.requestMagicLink(email);
      } catch (e: any) {
        set((s) => { s.error = e.detail ?? e.message; });
        throw e;
      } finally {
        set((s) => { s.isLoading = false; });
      }
    },

    verifyMagicLink: async (token) => {
      set((s) => { s.isLoading = true; s.error = null; });
      try {
        const data = await api.auth.verifyMagicLink(token);
        api.setTokens({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in,
        });
        await get().loadUser();
        set((s) => { s.isAuthenticated = true; });
      } catch (e: any) {
        set((s) => { s.error = e.detail ?? e.message; });
        throw e;
      } finally {
        set((s) => { s.isLoading = false; });
      }
    },

    devLogin: async (username, password) => {
      set((s) => { s.isLoading = true; s.error = null; });
      try {
        const data = await api.auth.devLogin(username, password);
        api.setTokens({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in,
        });
        await get().loadUser();
        set((s) => { s.isAuthenticated = true; });
      } catch (e: any) {
        set((s) => { s.error = e.detail ?? e.message; });
        throw e;
      } finally {
        set((s) => { s.isLoading = false; });
      }
    },

    logout: async () => {
      try { await api.auth.logout(); } catch {}
      api.clearTokens();
      set((s) => {
        s.user = null;
        s.preferences = null;
        s.quota = null;
        s.isAuthenticated = false;
      });
    },

    loadUser: async () => {
      if (!api.getAccessToken() && !sessionStorage.getItem('rt')) {
        set((s) => {
          s.user = null;
          s.quota = null;
          s.isAuthenticated = false;
          s.isLoading = false;
        });
        return;
      }
      set((s) => { s.isLoading = true; });
      try {
        const [u, q] = await Promise.all([api.user.getMe(), api.user.getQuota()]);
        set((s) => {
          s.user = u;
          s.quota = q;
          s.isAuthenticated = true;
        });
      } catch {
        set((s) => { s.isAuthenticated = false; });
      } finally {
        set((s) => { s.isLoading = false; });
      }
    },

    updatePreferences: async (prefs) => {
      await api.user.updateMe(prefs as any);
      set((s) => {
        if (s.preferences) Object.assign(s.preferences, prefs);
      });
    },

    clearError: () => set((s) => { s.error = null; }),
  })),
);
