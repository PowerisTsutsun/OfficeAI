import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Plus, Settings, MessageSquare, Zap, BookOpen,
  Moon, Sun, Monitor, ArrowRight, Command, ChevronRight,
  Trash2, Pin, Bot,
} from 'lucide-react';
import { useUIStore } from '@/store/uiStore';
import { useChatStore } from '@/store/chatStore';
import type { CommandItem } from '@/types';

// ── Command definitions ────────────────────────────────────────────────────────

function useCommands(): CommandItem[] {
  const { setTheme, closeCommandPalette, toggleSettingsPanel } = useUIStore();
  const { sessions, selectSession, deleteSession } = useChatStore();

  return useMemo(() => {
    const baseCommands: CommandItem[] = [
      {
        id: 'new-chat',
        label: 'New Chat',
        description: 'Start a new conversation',
        icon: 'plus',
        shortcut: '⌘N',
        group: 'actions',
        action: () => { selectSession(null); closeCommandPalette(); },
      },
      {
        id: 'toggle-settings',
        label: 'Session Settings',
        description: 'Toggle the settings panel',
        icon: 'settings',
        shortcut: '⌘]',
        group: 'settings',
        action: () => { toggleSettingsPanel(); closeCommandPalette(); },
      },
      {
        id: 'theme-dark',
        label: 'Dark Theme',
        description: 'Switch to dark mode',
        icon: 'moon',
        group: 'settings',
        action: () => { setTheme('dark'); closeCommandPalette(); },
      },
      {
        id: 'theme-light',
        label: 'Light Theme',
        description: 'Switch to light mode',
        icon: 'sun',
        group: 'settings',
        action: () => { setTheme('light'); closeCommandPalette(); },
      },
      {
        id: 'theme-system',
        label: 'System Theme',
        description: 'Follow system appearance',
        icon: 'monitor',
        group: 'settings',
        action: () => { setTheme('system'); closeCommandPalette(); },
      },
      {
        id: 'templates',
        label: 'Open Templates',
        description: 'Browse prompt templates',
        icon: 'book',
        shortcut: '⌘P',
        group: 'actions',
        action: () => { closeCommandPalette(); /* navigate to templates */ },
      },
    ];

    // Recent chats as commands
    const chatCommands: CommandItem[] = sessions.slice(0, 8).map((s) => ({
      id: `chat-${s.id}`,
      label: s.title || 'New Chat',
      description: `${s.provider} · ${s.model.split('-').slice(0, 2).join('-')}`,
      icon: 'chat',
      group: 'chats' as const,
      action: () => { selectSession(s.id); closeCommandPalette(); },
    }));

    return [...baseCommands, ...chatCommands];
  }, [createSession, closeCommandPalette, toggleSettingsPanel, setTheme, sessions, selectSession]);
}

// ── Icon map ──────────────────────────────────────────────────────────────────

function CommandIcon({ name }: { name?: string }) {
  const cls = "w-4 h-4";
  switch (name) {
    case 'plus':     return <Plus className={cls} />;
    case 'settings': return <Settings className={cls} />;
    case 'moon':     return <Moon className={cls} />;
    case 'sun':      return <Sun className={cls} />;
    case 'monitor':  return <Monitor className={cls} />;
    case 'book':     return <BookOpen className={cls} />;
    case 'chat':     return <MessageSquare className={cls} />;
    case 'zap':      return <Zap className={cls} />;
    default:         return <Command className={cls} />;
  }
}

// ── Group label ───────────────────────────────────────────────────────────────

const GROUP_LABELS: Record<string, string> = {
  actions: 'Actions',
  chats: 'Recent Chats',
  models: 'Models',
  templates: 'Templates',
  settings: 'Settings',
};

// ── Main CommandPalette ───────────────────────────────────────────────────────

export default function CommandPalette() {
  const { closeCommandPalette, commandQuery, setCommandQuery } = useUIStore();
  const allCommands = useCommands();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Filter commands
  const filtered = useMemo(() => {
    if (!commandQuery.trim()) return allCommands;
    const q = commandQuery.toLowerCase();
    return allCommands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (c.description ?? '').toLowerCase().includes(q),
    );
  }, [allCommands, commandQuery]);

  // Group filtered commands
  const grouped = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    for (const cmd of filtered) {
      if (!groups[cmd.group]) groups[cmd.group] = [];
      groups[cmd.group].push(cmd);
    }
    return groups;
  }, [filtered]);

  // Flat index for keyboard nav
  const flatList = filtered;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, flatList.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (flatList[selectedIndex]) {
            flatList[selectedIndex].action();
          }
          break;
        case 'Escape':
          closeCommandPalette();
          break;
      }
    },
    [flatList, selectedIndex, closeCommandPalette],
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [commandQuery]);

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-selected="true"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1 }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={closeCommandPalette}
      />

      {/* Palette */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -12 }}
        transition={{ duration: 0.15, ease: [0.34, 1.56, 0.64, 1] }}
        className="
          fixed top-[20%] left-1/2 -translate-x-1/2 z-50
          w-full max-w-[560px] mx-4
          bg-[--bg-elevated] border border-[--border-default]
          rounded-2xl shadow-[--shadow-xl] overflow-hidden
        "
        style={{ maxHeight: 'min(560px, 70vh)' }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[--border-subtle]">
          <Search className="w-4 h-4 text-[--text-tertiary] flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={commandQuery}
            onChange={(e) => setCommandQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands, chats, models…"
            className="
              flex-1 bg-transparent text-sm text-[--text-primary]
              placeholder:text-[--text-tertiary]
              focus:outline-none
            "
          />
          {commandQuery && (
            <button
              onClick={() => setCommandQuery('')}
              className="text-[--text-tertiary] hover:text-[--text-primary] text-xs px-1.5 py-0.5 rounded bg-[--bg-overlay] hover:bg-[--bg-hover] transition-colors"
            >
              Clear
            </button>
          )}
          <kbd className="px-1.5 py-0.5 rounded text-[10px] text-[--text-tertiary] bg-[--bg-overlay] border border-[--border-subtle] font-mono">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="overflow-y-auto"
          style={{ maxHeight: 'calc(min(560px, 70vh) - 56px)' }}
        >
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Search className="w-8 h-8 text-[--text-disabled]" />
              <p className="text-sm text-[--text-tertiary]">No results for "{commandQuery}"</p>
            </div>
          ) : (
            <div className="p-1.5">
              {Object.entries(grouped).map(([group, cmds]) => (
                <div key={group} className="mb-1">
                  {/* Group header */}
                  <div className="flex items-center gap-2 px-3 py-1.5">
                    <span className="text-[10px] font-semibold text-[--text-tertiary] uppercase tracking-wider">
                      {GROUP_LABELS[group] ?? group}
                    </span>
                    <div className="flex-1 h-px bg-[--border-subtle]" />
                  </div>

                  {/* Commands */}
                  {cmds.map((cmd) => {
                    const globalIdx = flatList.findIndex((c) => c.id === cmd.id);
                    const isSelected = globalIdx === selectedIndex;
                    return (
                      <motion.button
                        key={cmd.id}
                        data-selected={isSelected}
                        whileTap={{ scale: 0.98 }}
                        onClick={cmd.action}
                        onMouseEnter={() => setSelectedIndex(globalIdx)}
                        className={`
                          w-full flex items-center gap-3 px-3 py-2 rounded-xl
                          transition-colors duration-75 text-left
                          ${isSelected
                            ? 'bg-[--accent] text-white'
                            : 'hover:bg-[--bg-hover] text-[--text-secondary]'
                          }
                        `}
                      >
                        <div className={`flex-shrink-0 ${isSelected ? 'text-white' : 'text-[--text-tertiary]'}`}>
                          <CommandIcon name={cmd.icon} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-[--text-primary]'}`}>
                            {cmd.label}
                          </span>
                          {cmd.description && (
                            <p className={`text-xs truncate ${isSelected ? 'text-white/70' : 'text-[--text-tertiary]'}`}>
                              {cmd.description}
                            </p>
                          )}
                        </div>
                        {cmd.shortcut && (
                          <kbd className={`
                            flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded font-mono
                            ${isSelected
                              ? 'bg-white/20 text-white'
                              : 'bg-[--bg-overlay] text-[--text-tertiary] border border-[--border-subtle]'
                            }
                          `}>
                            {cmd.shortcut}
                          </kbd>
                        )}
                        {isSelected && (
                          <ArrowRight className="w-3.5 h-3.5 text-white flex-shrink-0" />
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-[--border-subtle] bg-[--bg-base]/50">
          <div className="flex items-center gap-1.5 text-[10px] text-[--text-disabled]">
            <kbd className="px-1 py-0.5 rounded bg-[--bg-overlay] font-mono">↑↓</kbd>
            <span>navigate</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-[--text-disabled]">
            <kbd className="px-1 py-0.5 rounded bg-[--bg-overlay] font-mono">Enter</kbd>
            <span>select</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-[--text-disabled]">
            <kbd className="px-1 py-0.5 rounded bg-[--bg-overlay] font-mono">Esc</kbd>
            <span>close</span>
          </div>
        </div>
      </motion.div>
    </>
  );
}
