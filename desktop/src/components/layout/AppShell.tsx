import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import TitleBar from './TitleBar';
import Sidebar from './Sidebar';
import ChatPanel from '../chat/ChatPanel';
import SettingsPanel from '../settings/SettingsPanel';
import CommandPalette from '../command/CommandPalette';
import { useUIStore } from '@/store/uiStore';
import { useChatStore } from '@/store/chatStore';
import { useAuthStore } from '@/store/authStore';

// Keyboard shortcuts hook
function useGlobalShortcuts() {
  const { openCommandPalette, toggleSidebar, toggleSettingsPanel } = useUIStore();
  const { createSession, cancelStream, isSending } = useChatStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      switch (e.key) {
        case 'k':
          e.preventDefault();
          openCommandPalette();
          break;
        case 'n':
          e.preventDefault();
          createSession({});
          break;
        case '\\':
          e.preventDefault();
          toggleSidebar();
          break;
        case ']':
          e.preventDefault();
          toggleSettingsPanel();
          break;
        case '.':
          if (isSending) {
            e.preventDefault();
            cancelStream();
          }
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openCommandPalette, toggleSidebar, toggleSettingsPanel, createSession, cancelStream, isSending]);
}

// Theme + accent initialization
function useThemeInit() {
  const { theme, accentColor, fontSize, reducedMotion, applyTheme } = useUIStore();

  useEffect(() => {
    applyTheme();
    document.documentElement.setAttribute('data-accent', accentColor);
    document.documentElement.style.setProperty('--font-size-base', `${fontSize}px`);
    if (reducedMotion) {
      document.documentElement.setAttribute('data-reduced-motion', 'true');
    }

    // Listen to system theme changes
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (theme === 'system') applyTheme(); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, accentColor, fontSize, reducedMotion, applyTheme]);
}

export default function AppShell() {
  useGlobalShortcuts();
  useThemeInit();

  const { settingsPanelOpen, commandPaletteOpen } = useUIStore();
  const { loadSessions, loadFolders, loadProviders } = useChatStore();
  const { loadUser } = useAuthStore();

  // Initial data load
  useEffect(() => {
    loadUser();
    loadSessions();
    loadFolders();
    loadProviders();
  }, []);

  return (
    <div className="flex flex-col h-screen bg-[--bg-base] overflow-hidden">
      {/* Native title bar */}
      <TitleBar />

      {/* Main layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left sidebar */}
        <Sidebar />

        {/* Chat area */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <ChatPanel />
        </main>

        {/* Right settings panel */}
        <motion.div
          initial={false}
          animate={{
            width: settingsPanelOpen ? 280 : 0,
            opacity: settingsPanelOpen ? 1 : 0,
          }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          className="flex-shrink-0 overflow-hidden border-l border-[--border-subtle]"
        >
          <div className="w-70 h-full">
            <SettingsPanel />
          </div>
        </motion.div>
      </div>

      {/* Global overlays */}
      {commandPaletteOpen && <CommandPalette />}
    </div>
  );
}
