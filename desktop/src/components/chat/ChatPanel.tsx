import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, Settings2, MoreHorizontal, Pin, Trash2,
  Edit2, Zap, Bot,
} from 'lucide-react';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import { useChatStore } from '@/store/chatStore';
import { useUIStore } from '@/store/uiStore';

// ── Provider badge ─────────────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  openai: '#10a37f',
  anthropic: '#d4763b',
  gemini: '#4285f4',
};

function ModelBadge({ provider, model }: { provider: string; model: string }) {
  const color = PROVIDER_COLORS[provider] ?? '#888';
  const shortModel = model.split('-').slice(0, 3).join('-');
  const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[--bg-elevated] border border-[--border-subtle] cursor-pointer hover:border-[--border-default] transition-colors">
      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-xs font-medium text-[--text-secondary]">{providerLabel}</span>
      <span className="text-[11px] text-[--text-tertiary] font-mono">{shortModel}</span>
      <ChevronDown className="w-3 h-3 text-[--text-tertiary]" />
    </div>
  );
}

// ── Chat header ────────────────────────────────────────────────────────────────

function ChatHeader() {
  const { activeSession, updateSession, deleteSession } = useChatStore();
  const { toggleSettingsPanel } = useUIStore();
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  if (!activeSession) return null;

  const handleRename = () => {
    if (renameValue.trim()) {
      updateSession(activeSession.id, { title: renameValue.trim() } as any);
    }
    setIsRenaming(false);
  };

  const totalTokens = activeSession.totalTokensIn + activeSession.totalTokensOut;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[--border-subtle] bg-[--bg-surface] flex-shrink-0">
      {/* Title */}
      <div className="flex-1 min-w-0">
        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setIsRenaming(false); }}
            className="bg-[--bg-elevated] border border-[--accent] rounded px-2 py-0.5 text-sm text-[--text-primary] outline-none w-full max-w-xs"
          />
        ) : (
          <h2
            className="text-sm font-semibold text-[--text-primary] truncate cursor-text"
            onClick={() => { setRenameValue(activeSession.title ?? ''); setIsRenaming(true); }}
          >
            {activeSession.title || 'New Chat'}
          </h2>
        )}
      </div>

      {/* Model badge */}
      <div onClick={toggleSettingsPanel}>
        <ModelBadge provider={activeSession.provider} model={activeSession.model} />
      </div>

      {/* Token usage */}
      {totalTokens > 0 && (
        <div className="flex items-center gap-1 text-[11px] text-[--text-disabled]">
          <Zap className="w-3 h-3" />
          <span className="font-mono">{totalTokens.toLocaleString()}</span>
        </div>
      )}

      {/* Ephemeral badge */}
      {activeSession.isEphemeral && (
        <div className="px-2 py-0.5 rounded-full bg-[--color-warning]/15 border border-[--color-warning]/30">
          <span className="text-[10px] font-medium text-[--color-warning]">ephemeral</span>
        </div>
      )}

      {/* Settings toggle */}
      <button
        onClick={toggleSettingsPanel}
        className="w-7 h-7 flex items-center justify-center rounded-lg text-[--text-tertiary] hover:text-[--text-primary] hover:bg-[--bg-hover] transition-colors"
        aria-label="Session settings"
      >
        <Settings2 className="w-3.5 h-3.5" />
      </button>

      {/* More menu */}
      <div className="relative">
        <button
          onClick={() => setMoreMenuOpen(!moreMenuOpen)}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-[--text-tertiary] hover:text-[--text-primary] hover:bg-[--bg-hover] transition-colors"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>

        <AnimatePresence>
          {moreMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMoreMenuOpen(false)} />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                transition={{ duration: 0.1 }}
                className="absolute right-0 top-8 z-20 context-menu min-w-[160px]"
              >
                <div
                  className="context-menu-item"
                  onClick={() => {
                    updateSession(activeSession.id, { isPinned: !activeSession.isPinned } as any);
                    setMoreMenuOpen(false);
                  }}
                >
                  <Pin className="w-3.5 h-3.5" />
                  <span>{activeSession.isPinned ? 'Unpin' : 'Pin'} chat</span>
                </div>
                <div
                  className="context-menu-item"
                  onClick={() => {
                    setRenameValue(activeSession.title ?? '');
                    setIsRenaming(true);
                    setMoreMenuOpen(false);
                  }}
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Rename</span>
                </div>
                <div className="h-px bg-[--border-subtle] my-1" />
                <div
                  className="context-menu-item destructive"
                  onClick={() => { deleteSession(activeSession.id); setMoreMenuOpen(false); }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete chat</span>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── No session state ──────────────────────────────────────────────────────────

function NoSessionState() {
  const { createSession, providers, selectedProvider, selectedModel, setModel } = useChatStore();

  // Build flat list of quick-pick models (first model from each provider)
  const quickPicks = providers.flatMap((p) =>
    p.models.slice(0, 1).map((m) => ({
      provider: p.name,
      model: m.modelId,
      label: m.displayName,
      color: PROVIDER_COLORS[p.name] ?? '#888',
    }))
  );

  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 select-none">
      <div className="w-16 h-16 rounded-2xl bg-[--bg-elevated] border border-[--border-subtle] flex items-center justify-center">
        <Bot className="w-8 h-8 text-[--text-tertiary]" />
      </div>
      <div className="text-center">
        <h2 className="text-lg font-semibold text-[--text-primary]">Company AI Desktop</h2>
        <p className="text-sm text-[--text-tertiary] mt-1">Your AI assistant for work</p>
      </div>
      <button
        onClick={() => createSession({})}
        className="
          flex items-center gap-2 px-5 py-2.5 rounded-xl
          bg-[--accent] hover:bg-[--accent-hover] text-white
          text-sm font-medium transition-colors shadow-sm
        "
      >
        Start new chat
        <span className="text-white/60 text-xs">⌘N</span>
      </button>
      <div className="flex flex-wrap justify-center gap-2 max-w-md">
        {quickPicks.map(({ provider, model, label, color }) => {
          const isSelected = selectedProvider === provider && selectedModel === model;
          return (
            <button
              key={`${provider}-${model}`}
              onClick={() => {
                setModel(provider, model);
                createSession({ provider, model });
              }}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors cursor-pointer
                ${isSelected
                  ? 'bg-[--accent]/10 border-[--accent] text-[--text-primary]'
                  : 'bg-[--bg-elevated] border-[--border-subtle] text-[--text-tertiary] hover:border-[--border-default] hover:text-[--text-secondary]'
                }
              `}
            >
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-[11px] font-medium">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Main ChatPanel ────────────────────────────────────────────────────────────

export default function ChatPanel() {
  const { activeSession, activeSessionId, messagesBySession, messagesLoading } = useChatStore();

  const messages = activeSessionId ? (messagesBySession[activeSessionId] ?? []) : [];

  return (
    <div className="flex flex-col h-full bg-[--bg-base] overflow-hidden">
      <AnimatePresence mode="wait">
        {activeSession ? (
          <motion.div
            key={activeSessionId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col h-full"
          >
            <ChatHeader />
            <MessageList
              messages={messages}
              isLoading={messagesLoading}
            />
            <MessageInput />
          </motion.div>
        ) : (
          <motion.div
            key="no-session"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex-1"
          >
            <NoSessionState />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
