import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import AppShell from './components/layout/AppShell';
import LoginPage from './components/auth/LoginPage';
import { useAuthStore } from './store/authStore';
import { loadStoredTokens } from './lib/api';

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen bg-[--bg-base]">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col items-center gap-3"
      >
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[--accent] to-[--accent-hover] flex items-center justify-center">
          <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-[--accent]"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
}

export default function App() {
  const { isAuthenticated, isLoading, loadUser } = useAuthStore();
  const [bootstrapped, setBootstrapped] = useState(false);

  // Extract magic link token from URL (for web fallback; Tauri uses deep link)
  const params = new URLSearchParams(window.location.search);
  const verifyToken = params.get('token') ?? undefined;

  useEffect(() => {
    // Load tokens from storage, then try to load user
    loadStoredTokens();
    loadUser().finally(() => setBootstrapped(true));
  }, []);

  // Apply stored theme immediately before first render
  useEffect(() => {
    const stored = localStorage.getItem('ui-prefs');
    if (stored) {
      try {
        const prefs = JSON.parse(stored)?.state;
        if (prefs?.theme) {
          const isDark =
            prefs.theme === 'dark' ||
            (prefs.theme === 'system' &&
              window.matchMedia('(prefers-color-scheme: dark)').matches);
          document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
        }
        if (prefs?.accentColor) {
          document.documentElement.setAttribute('data-accent', prefs.accentColor);
        }
      } catch {}
    }
  }, []);

  if (!bootstrapped) return <LoadingScreen />;

  return (
    <AnimatePresence mode="wait">
      {isAuthenticated ? (
        <motion.div
          key="app"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="h-screen overflow-hidden"
        >
          <AppShell />
        </motion.div>
      ) : (
        <motion.div
          key="login"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="h-screen overflow-hidden"
        >
          <LoginPage verifyToken={verifyToken} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
