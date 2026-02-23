import React, { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Search, Pin, Folder, MessageSquare, Settings,
  MoreHorizontal, Trash2, Edit2, Tag, ChevronRight,
  Star, Hash,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useChatStore } from '@/store/chatStore';
import { useUIStore } from '@/store/uiStore';
import { useAuthStore } from '@/store/authStore';
import type { ChatSession } from '@/types';

// ── Chat list item ─────────────────────────────────────────────────────────────

interface ChatItemProps {
  session: ChatSession;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string) => void;
}

function ChatItem({ session, isActive, onSelect, onDelete, onRename, onPin }: ChatItemProps) {
  const { providers } = useChatStore();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(session.title ?? '');

  const title = session.title || 'New Chat';
  const timeAgo = session.lastMessageAt
    ? formatDistanceToNow(new Date(session.lastMessageAt), { addSuffix: true })
    : '';

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleRenameSubmit = () => {
    if (renameValue.trim()) onRename(session.id, renameValue.trim());
    setIsRenaming(false);
  };

  const provider = providers.find((p) => p.name === session.provider);
  const modelDisplay = provider?.models.find((m) => m.modelId === session.model)?.displayName;
  const modelShort = modelDisplay ?? session.model.split('-').slice(0, 2).join('-');

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -8 }}
        transition={{ duration: 0.15 }}
        onContextMenu={handleContextMenu}
        onClick={() => !isRenaming && onSelect(session.id)}
        className={`
          group relative flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer
          transition-colors duration-100 mx-1
          ${isActive
            ? 'bg-[--bg-active] text-[--text-primary]'
            : 'text-[--text-secondary] hover:bg-[--bg-hover] hover:text-[--text-primary]'
          }
        `}
      >
        {/* Icon */}
        <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
          {session.isPinned ? (
            <Pin className="w-3.5 h-3.5 text-[--accent] rotate-45" />
          ) : (
            <MessageSquare className="w-3.5 h-3.5" />
          )}
        </div>

        {/* Title + meta */}
        <div className="flex-1 min-w-0">
          {isRenaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit();
                if (e.key === 'Escape') setIsRenaming(false);
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-[--bg-overlay] border border-[--accent] rounded px-1.5 py-0.5 text-xs text-[--text-primary] outline-none"
            />
          ) : (
            <>
              <p className="text-xs font-medium leading-tight truncate">{title}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] text-[--text-tertiary] truncate">{timeAgo}</span>
                {session.isEphemeral && (
                  <span className="text-[9px] px-1 rounded bg-[--bg-overlay] text-[--text-tertiary]">
                    ephemeral
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Provider badge — visible on hover */}
        <div className={`
          flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity
          text-[9px] px-1.5 py-0.5 rounded bg-[--bg-overlay] text-[--text-tertiary] font-mono
          ${isActive ? 'opacity-100' : ''}
        `}>
          {modelShort}
        </div>

        {/* Active indicator */}
        {isActive && (
          <motion.div
            layoutId="active-indicator"
            className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[--accent] rounded-full"
          />
        )}
      </motion.div>

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            items={[
              {
                label: session.isPinned ? 'Unpin' : 'Pin',
                icon: <Pin className="w-3.5 h-3.5" />,
                onClick: () => onPin(session.id),
              },
              {
                label: 'Rename',
                icon: <Edit2 className="w-3.5 h-3.5" />,
                onClick: () => {
                  setRenameValue(session.title ?? '');
                  setIsRenaming(true);
                },
              },
              { divider: true },
              {
                label: 'Delete',
                icon: <Trash2 className="w-3.5 h-3.5" />,
                destructive: true,
                onClick: () => onDelete(session.id),
              },
            ]}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ── Context menu ───────────────────────────────────────────────────────────────

interface ContextMenuItem {
  label?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  destructive?: boolean;
  divider?: boolean;
}

function ContextMenu({
  x, y, onClose, items,
}: { x: number; y: number; onClose: () => void; items: ContextMenuItem[] }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.1, ease: 'easeOut' }}
        style={{ top: y, left: x }}
        className="fixed z-50 context-menu"
      >
        {items.map((item, i) =>
          item.divider ? (
            <div key={i} className="h-px bg-[--border-subtle] my-1" />
          ) : (
            <div
              key={i}
              className={`context-menu-item ${item.destructive ? 'destructive' : ''}`}
              onClick={() => { item.onClick?.(); onClose(); }}
            >
              {item.icon}
              <span>{item.label}</span>
            </div>
          ),
        )}
      </motion.div>
    </>
  );
}

// ── Group by date ──────────────────────────────────────────────────────────────

function groupSessionsByDate(sessions: ChatSession[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const lastWeek = new Date(today.getTime() - 7 * 86400000);

  const groups: { label: string; sessions: ChatSession[] }[] = [
    { label: 'Pinned', sessions: [] },
    { label: 'Today', sessions: [] },
    { label: 'Yesterday', sessions: [] },
    { label: 'Last 7 days', sessions: [] },
    { label: 'Older', sessions: [] },
  ];

  for (const s of sessions) {
    if (s.isPinned) {
      groups[0].sessions.push(s);
      continue;
    }
    const date = s.lastMessageAt ? new Date(s.lastMessageAt) : new Date(s.createdAt);
    if (date >= today) groups[1].sessions.push(s);
    else if (date >= yesterday) groups[2].sessions.push(s);
    else if (date >= lastWeek) groups[3].sessions.push(s);
    else groups[4].sessions.push(s);
  }

  return groups.filter((g) => g.sessions.length > 0);
}

// ── Main Sidebar ──────────────────────────────────────────────────────────────

export default function Sidebar() {
  const { sessions, activeSessionId, startNewChat, selectSession, updateSession, deleteSession } = useChatStore();
  const { sidebarOpen, openCommandPalette } = useUIStore();
  const { user } = useAuthStore();

  const [search, setSearch] = useState('');

  const filteredSessions = useMemo(() => {
    if (!search.trim()) return sessions;
    const q = search.toLowerCase();
    return sessions.filter((s) => (s.title ?? '').toLowerCase().includes(q));
  }, [sessions, search]);

  const groups = useMemo(() => groupSessionsByDate(filteredSessions), [filteredSessions]);

  const handleNewChat = useCallback(() => {
    void startNewChat();
  }, [startNewChat]);

  const handlePin = useCallback((id: string) => {
    const s = sessions.find((s) => s.id === id);
    if (s) updateSession(id, { isPinned: !s.isPinned } as any);
  }, [sessions, updateSession]);

  return (
    <AnimatePresence mode="wait">
      {sidebarOpen && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 240, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          className="flex flex-col h-full bg-[--bg-surface] border-r border-[--border-subtle] flex-shrink-0 overflow-hidden"
        >
          {/* Search bar */}
          <div className="px-2 pt-2 pb-1 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[--text-tertiary]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search chats..."
                className="
                  w-full pl-7.5 pr-8 py-1.5 text-xs rounded-lg
                  bg-[--bg-elevated] border border-[--border-subtle]
                  text-[--text-primary] placeholder:text-[--text-tertiary]
                  focus:outline-none focus:border-[--accent]
                  transition-colors
                "
              />
              {/* Cmd+K hint */}
              <button
                onClick={openCommandPalette}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 px-1 py-0.5 rounded text-[9px] text-[--text-tertiary] bg-[--bg-overlay] hover:bg-[--bg-hover] transition-colors"
              >
                ⌘K
              </button>
            </div>
          </div>

          {/* New chat button */}
          <div className="px-2 pb-1 flex-shrink-0">
            <button
              onClick={handleNewChat}
              className="
                w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs
                font-medium text-[--text-secondary]
                hover:bg-[--bg-hover] hover:text-[--text-primary]
                border border-dashed border-[--border-subtle] hover:border-[--border-default]
                transition-all duration-100
              "
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Chat</span>
              <span className="ml-auto text-[10px] text-[--text-tertiary]">⌘N</span>
            </button>
          </div>

          {/* Chat list */}
          <div className="flex-1 overflow-y-auto py-1">
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 px-4">
                <MessageSquare className="w-8 h-8 text-[--text-disabled]" />
                <p className="text-xs text-[--text-tertiary] text-center leading-snug">
                  No chats yet. Start a new conversation.
                </p>
              </div>
            ) : groups.length === 0 ? (
              <div className="flex flex-col items-center py-8 gap-1">
                <Search className="w-6 h-6 text-[--text-disabled]" />
                <p className="text-xs text-[--text-tertiary]">No results</p>
              </div>
            ) : (
              <AnimatePresence>
                {groups.map((group) => (
                  <div key={group.label} className="mb-1">
                    <div className="flex items-center gap-1.5 px-3 py-1">
                      <span className="text-[10px] font-semibold text-[--text-tertiary] uppercase tracking-wider">
                        {group.label}
                      </span>
                      <div className="flex-1 h-px bg-[--border-subtle]" />
                    </div>
                    {group.sessions.map((session) => (
                      <ChatItem
                        key={session.id}
                        session={session}
                        isActive={session.id === activeSessionId}
                        onSelect={selectSession}
                        onDelete={deleteSession}
                        onRename={(id, title) => updateSession(id, { title } as any)}
                        onPin={handlePin}
                      />
                    ))}
                  </div>
                ))}
              </AnimatePresence>
            )}
          </div>

          {/* Bottom bar: User */}
          <div className="flex-shrink-0 border-t border-[--border-subtle] p-2.5">

            {/* User avatar */}
            <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-[--text-secondary] hover:bg-[--bg-hover] cursor-pointer transition-colors">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[--accent] to-[--accent-hover] flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
                {(user?.displayName ?? user?.email ?? 'U')[0].toUpperCase()}
              </div>
              <span className="truncate flex-1 text-[--text-primary] font-medium">
                {user?.displayName ?? user?.email ?? 'User'}
              </span>
              <Settings className="w-4 h-4 flex-shrink-0" />
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}


