import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist } from 'zustand/middleware';
import type { Theme, AccentColor } from '@/types';

interface UIState {
  theme: Theme;
  accentColor: AccentColor;
  fontSize: number;
  reducedMotion: boolean;
  compactMode: boolean;
  sidebarWidth: number;

  // Panel visibility
  sidebarOpen: boolean;
  settingsPanelOpen: boolean;
  commandPaletteOpen: boolean;

  // Command palette
  commandQuery: string;
}

interface UIActions {
  setTheme: (t: Theme) => void;
  setAccentColor: (c: AccentColor) => void;
  setFontSize: (s: number) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (v: boolean) => void;
  toggleSettingsPanel: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  setCommandQuery: (q: string) => void;
  applyTheme: () => void;
}

export const useUIStore = create<UIState & UIActions>()(
  persist(
    immer((set, get) => ({
      theme: 'dark',
      accentColor: 'blue',
      fontSize: 15,
      reducedMotion: false,
      compactMode: false,
      sidebarWidth: 240,

      sidebarOpen: true,
      settingsPanelOpen: false,
      commandPaletteOpen: false,
      commandQuery: '',

      setTheme: (t) => {
        set((s) => { s.theme = t; });
        get().applyTheme();
      },

      setAccentColor: (c) => {
        set((s) => { s.accentColor = c; });
        document.documentElement.setAttribute('data-accent', c);
      },

      setFontSize: (size) => {
        set((s) => { s.fontSize = size; });
        document.documentElement.style.setProperty('--font-size-base', `${size}px`);
      },

      toggleSidebar: () => set((s) => { s.sidebarOpen = !s.sidebarOpen; }),
      setSidebarOpen: (v) => set((s) => { s.sidebarOpen = v; }),

      toggleSettingsPanel: () =>
        set((s) => { s.settingsPanelOpen = !s.settingsPanelOpen; }),

      openCommandPalette: () =>
        set((s) => { s.commandPaletteOpen = true; s.commandQuery = ''; }),

      closeCommandPalette: () =>
        set((s) => { s.commandPaletteOpen = false; s.commandQuery = ''; }),

      setCommandQuery: (q) => set((s) => { s.commandQuery = q; }),

      applyTheme: () => {
        const { theme } = get();
        const root = document.documentElement;
        const isDark =
          theme === 'dark' ||
          (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        root.setAttribute('data-theme', isDark ? 'dark' : 'light');
      },
    })),
    {
      name: 'ui-prefs',
      partialize: (s) => ({
        theme: s.theme,
        accentColor: s.accentColor,
        fontSize: s.fontSize,
        reducedMotion: s.reducedMotion,
        compactMode: s.compactMode,
        sidebarWidth: s.sidebarWidth,
      }),
    },
  ),
);
