import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, Settings2, MoreHorizontal, Pin, Trash2,
  Edit2, Zap, SlidersHorizontal, MessageSquare, Send, Paperclip,
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

function ModelBadge({ provider, modelLabel }: { provider: string; modelLabel: string }) {
  const color = PROVIDER_COLORS[provider] ?? '#888';
  const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[--bg-elevated] border border-[--border-subtle] cursor-pointer hover:border-[--border-default] transition-colors">
      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-xs font-medium text-[--text-secondary]">{providerLabel}</span>
      <span className="text-[11px] text-[--text-tertiary] font-mono">{modelLabel}</span>
      <ChevronDown className="w-3 h-3 text-[--text-tertiary]" />
    </div>
  );
}

// ── View mode toggle ────────────────────────────────────────────────────────────

function ViewModeToggle() {
  const { chatViewMode, toggleChatViewMode } = useUIStore();
  const isSimple = chatViewMode === 'simple';

  return (
    <button
      onClick={toggleChatViewMode}
      className="w-7 h-7 flex items-center justify-center rounded-lg text-[--text-tertiary] hover:text-[--text-primary] hover:bg-[--bg-hover] transition-colors"
      aria-label={isSimple ? 'Switch to advanced view' : 'Switch to simple view'}
      title={isSimple ? 'Advanced view' : 'Simple view'}
    >
      {isSimple ? (
        <SlidersHorizontal className="w-3.5 h-3.5" />
      ) : (
        <MessageSquare className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

// ── Simple header ───────────────────────────────────────────────────────────────

function SimpleHeader() {
  const { activeSession } = useChatStore();
  if (!activeSession) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[--border-subtle] bg-[--bg-surface] flex-shrink-0">
      <div className="flex-1 min-w-0">
        <h2 className="text-sm font-semibold text-[--text-primary] truncate">
          {activeSession.title || 'New Chat'}
        </h2>
      </div>
      <ViewModeToggle />
    </div>
  );
}

// ── Advanced header ─────────────────────────────────────────────────────────────

function AdvancedHeader() {
  const {
    activeSession,
    updateSession,
    deleteSession,
    providers,
    setModel,
  } = useChatStore();
  const { toggleSettingsPanel } = useUIStore();
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  if (!activeSession) return null;

  const provider = providers.find((p) => p.name === activeSession.provider);
  const model = provider?.models.find((m) => m.modelId === activeSession.model);
  const modelLabel = model?.displayName ?? activeSession.model;
  const availableModels = provider?.models
    .filter((m) => m.isEnabled)
    .sort((a, b) => a.sortOrder - b.sortOrder) ?? [];

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

      {/* Model badge + dropdown */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setModelMenuOpen((v) => !v)}
          className="p-0 bg-transparent border-0"
          aria-label="Select model version"
        >
          <ModelBadge provider={activeSession.provider} modelLabel={modelLabel} />
        </button>

        <AnimatePresence>
          {modelMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setModelMenuOpen(false)}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.98, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: -4 }}
                transition={{ duration: 0.1 }}
                className="absolute right-0 top-9 z-20 context-menu min-w-[220px]"
              >
                {availableModels.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-[--text-tertiary]">
                    No models available
                  </div>
                ) : (
                  availableModels.map((m) => {
                    const isActive = m.modelId === activeSession.model;
                    return (
                      <button
                        key={m.id}
                        onClick={async () => {
                          setModel(provider?.name ?? activeSession.provider, m.modelId);
                          await updateSession(activeSession.id, {
                            provider: provider?.name ?? activeSession.provider,
                            model: m.modelId,
                          } as any);
                          setModelMenuOpen(false);
                        }}
                        className={`
                          w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md
                          text-left transition-colors text-xs
                          ${isActive
                            ? 'bg-[--accent-subtle] text-[--accent]'
                            : 'hover:bg-[--bg-hover] text-[--text-secondary]'
                          }
                        `}
                      >
                        <span className="flex-1 font-medium">{m.displayName}</span>
                        <span className="text-[10px] font-mono text-[--text-disabled]">
                          {(m.contextWindow / 1000).toFixed(0)}k
                        </span>
                        {m.isBeta && (
                          <span className="text-[9px] px-1 rounded bg-[--color-warning]/15 text-[--color-warning]">
                            beta
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>
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

      {/* View mode toggle */}
      <ViewModeToggle />

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

// ── Simple no-session state ─────────────────────────────────────────────────────

function SimpleNoSessionState() {
  const { createSession, sendMessage, providers, selectedProvider, selectedModel, setModel } = useChatStore();
  const [value, setValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showModels, setShowModels] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileAttach = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const header = `--- ${file.name} ---\n`;
      setValue((prev) => prev + (prev ? '\n\n' : '') + header + text + '\n--- end ---\n');
      textareaRef.current?.focus();
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const allModels = providers.flatMap((p) =>
    p.models.filter((m) => m.isEnabled).slice(0, 2).map((m) => ({
      provider: p.name,
      modelId: m.modelId,
      label: m.displayName,
      color: PROVIDER_COLORS[p.name] ?? '#888',
    }))
  );

  const currentModel = allModels.find(
    (m) => m.provider === selectedProvider && m.modelId === selectedModel
  );

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const newHeight = Math.min(ta.scrollHeight, 160);
    ta.style.height = `${newHeight}px`;
  }, [value]);

  const handleSend = useCallback(async () => {
    const content = value.trim();
    if (!content || isSending) return;
    setIsSending(true);
    try {
      await createSession({ provider: selectedProvider, model: selectedModel });
      setValue('');
      // Small delay so the session is active before sending
      await new Promise((r) => setTimeout(r, 50));
      await sendMessage(content);
    } finally {
      setIsSending(false);
    }
  }, [value, isSending, createSession, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 select-none">
      <div className="w-full max-w-lg flex flex-col items-center gap-6">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[--accent]/20 to-[--accent]/5 border border-[--accent]/20 flex items-center justify-center">
          <MessageSquare className="w-6 h-6 text-[--accent]" />
        </div>
        <h2 className="text-xl font-semibold text-[--text-primary]">What can I help with?</h2>

        {/* Model picker toggle */}
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={() => setShowModels((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[--bg-elevated] border border-[--border-subtle] hover:border-[--border-default] transition-colors text-xs text-[--text-tertiary] hover:text-[--text-secondary]"
          >
            {currentModel && (
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: currentModel.color }} />
            )}
            <span>{currentModel?.label ?? selectedModel}</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${showModels ? 'rotate-180' : ''}`} />
          </button>
          <AnimatePresence>
            {showModels && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-2 gap-1.5 w-full max-w-xs">
                  {allModels.map((m) => {
                    const active = selectedProvider === m.provider && selectedModel === m.modelId;
                    return (
                      <button
                        key={`${m.provider}-${m.modelId}`}
                        onClick={() => {
                          setModel(m.provider, m.modelId);
                          setShowModels(false);
                        }}
                        className={`flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors ${
                          active
                            ? 'bg-[--accent]/10 border-[--accent] text-[--text-primary]'
                            : 'bg-[--bg-elevated] border-[--border-subtle] text-[--text-tertiary] hover:border-[--border-default] hover:text-[--text-secondary]'
                        }`}
                      >
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.color }} />
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Inline chat input */}
        <motion.div
          animate={{
            boxShadow: isFocused
              ? '0 0 0 1.5px var(--accent), 0 4px 20px rgba(0,0,0,0.2)'
              : '0 0 0 1px var(--border-subtle), 0 2px 8px rgba(0,0,0,0.1)',
          }}
          transition={{ duration: 0.15 }}
          className="w-full bg-[--bg-elevated] rounded-2xl overflow-hidden"
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Type a message…"
            disabled={isSending}
            className="
              w-full bg-transparent resize-none px-4 pt-3 pb-2
              text-[--text-primary] placeholder:text-[--text-tertiary]
              text-sm leading-relaxed focus:outline-none
              min-h-[52px] max-h-[160px]
              disabled:opacity-50
            "
            style={{ fontFamily: 'var(--font-sans)' }}
            rows={1}
          />
          <div className="flex items-center gap-1.5 px-3 pb-2.5">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".txt,.md,.csv,.json,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.rs,.go,.java,.c,.cpp,.h,.yaml,.yml,.toml,.env,.log,.sql,.sh"
              onChange={handleFileChange}
            />
            <button
              onClick={handleFileAttach}
              disabled={isSending}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-[--text-tertiary] hover:text-[--text-primary] hover:bg-[--bg-hover] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Attach file"
              title="Attach file"
            >
              <Paperclip className="w-3.5 h-3.5" />
            </button>
            <div className="flex-1" />
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={handleSend}
              disabled={!value.trim() || isSending}
              className={`
                w-8 h-8 flex items-center justify-center rounded-xl
                font-medium text-sm transition-all duration-100
                ${value.trim() && !isSending
                  ? 'bg-[--accent] text-white hover:bg-[--accent-hover] shadow-sm'
                  : 'bg-[--bg-overlay] text-[--text-disabled] cursor-not-allowed'
                }
              `}
              aria-label="Send message"
            >
              <Send className="w-3.5 h-3.5" />
            </motion.button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// ── Main ChatPanel ────────────────────────────────────────────────────────────

export default function ChatPanel() {
  const { activeSession, activeSessionId, messagesBySession, messagesLoading } = useChatStore();
  const { chatViewMode } = useUIStore();
  const isSimple = chatViewMode === 'simple';

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
            {isSimple ? <SimpleHeader /> : <AdvancedHeader />}
            <MessageList
              messages={messages}
              isLoading={messagesLoading}
            />
            <MessageInput simple={isSimple} />
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
            <SimpleNoSessionState />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
