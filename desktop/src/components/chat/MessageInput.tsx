import React, { useRef, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Square, Zap, BookOpen, Paperclip, AlertTriangle } from 'lucide-react';
import { useChatStore } from '@/store/chatStore';
import { useAuthStore } from '@/store/authStore';

// Rough token estimate for live counter
function estimateTokens(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4));
}

function TokenIndicator({
  count,
  limit,
}: {
  count: number;
  limit: number;
}) {
  const pct = Math.min(1, count / limit);
  const isWarning = pct > 0.8;
  const isOver = pct >= 1;

  return (
    <div className="flex items-center gap-1.5">
      {isOver && <AlertTriangle className="w-3 h-3 text-[--color-error]" />}
      <span className={`text-[10px] font-mono ${
        isOver ? 'text-[--color-error]' :
        isWarning ? 'text-[--color-warning]' :
        'text-[--text-disabled]'
      }`}>
        ~{count.toLocaleString()} / {(limit / 1000).toFixed(0)}k tokens
      </span>
    </div>
  );
}

export default function MessageInput({ simple = false }: { simple?: boolean }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

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

  const { sendMessage, cancelStream, isSending, activeSessionId } = useChatStore();
  const { quota } = useAuthStore();

  const tokenCount = estimateTokens(value);
  const tokenLimit = quota?.contextWindowLimit ?? 128000;
  const isOverLimit = tokenCount > tokenLimit;
  const canSend = value.trim().length > 0 && !isSending && !isOverLimit && !!activeSessionId;

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const newHeight = Math.min(ta.scrollHeight, 240);
    ta.style.height = `${newHeight}px`;
  }, [value]);

  // Focus input when session changes
  useEffect(() => {
    textareaRef.current?.focus();
  }, [activeSessionId]);

  const handleSend = useCallback(async () => {
    const content = value.trim();
    if (!content || isSending || !activeSessionId) return;
    setValue('');
    textareaRef.current?.focus();
    await sendMessage(content);
  }, [value, isSending, activeSessionId, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      // Escape cancels stream
      if (e.key === 'Escape' && isSending) {
        cancelStream();
      }
    },
    [handleSend, isSending, cancelStream],
  );

  const handleTemplateInsert = (content: string) => {
    setValue(content);
    setShowTemplates(false);
    textareaRef.current?.focus();
  };

  return (
    <div className="flex-shrink-0 px-4 pb-4 pt-2">
      <motion.div
        animate={{
          boxShadow: isFocused
            ? `0 0 0 1.5px var(--accent), 0 4px 20px rgba(0,0,0,0.2)`
            : `0 0 0 1px var(--border-subtle), 0 2px 8px rgba(0,0,0,0.1)`,
        }}
        transition={{ duration: 0.15 }}
        className="relative bg-[--bg-elevated] rounded-2xl overflow-hidden"
      >
        {/* Ephemeral indicator (advanced only) */}
        <AnimatePresence>
          {!simple && useChatStore.getState().activeSession?.isEphemeral && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-1.5 px-4 py-1.5 bg-[--color-warning]/10 border-b border-[--color-warning]/20">
                <div className="w-1.5 h-1.5 rounded-full bg-[--color-warning]" />
                <span className="text-[10px] text-[--color-warning] font-medium">
                  Ephemeral mode — this conversation won't be saved
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={
            activeSessionId
              ? simple
                ? 'Type a message…'
                : 'Message… (Enter to send, Shift+Enter for new line)'
              : 'Select or create a chat to start'
          }
          disabled={!activeSessionId || (isSending && !value)}
          className="
            w-full bg-transparent resize-none px-4 pt-3 pb-2
            text-[--text-primary] placeholder:text-[--text-tertiary]
            text-sm leading-relaxed
            focus:outline-none
            min-h-[52px] max-h-[240px]
            selectable
            disabled:opacity-50 disabled:cursor-not-allowed
          "
          style={{ fontFamily: 'var(--font-sans)' }}
          rows={1}
        />

        {/* Bottom toolbar */}
        <div className="flex items-center gap-1.5 px-3 pb-2.5">
          {/* Attach file (always visible) */}
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

          {/* Templates (advanced only) */}
          {!simple && (
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className={`
                w-7 h-7 flex items-center justify-center rounded-lg transition-colors
                ${showTemplates
                  ? 'bg-[--accent-subtle] text-[--accent]'
                  : 'text-[--text-tertiary] hover:text-[--text-primary] hover:bg-[--bg-hover]'
                }
              `}
              aria-label="Insert template"
            >
              <BookOpen className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Token counter (advanced only) */}
          {!simple && value.length > 0 && (
            <TokenIndicator count={tokenCount} limit={tokenLimit} />
          )}

          {/* Send / Stop button */}
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={isSending ? cancelStream : handleSend}
            disabled={!isSending && !canSend}
            className={`
              w-8 h-8 flex items-center justify-center rounded-xl
              font-medium text-sm transition-all duration-100
              ${isSending
                ? 'bg-[--color-error]/15 text-[--color-error] hover:bg-[--color-error]/25'
                : canSend
                  ? 'bg-[--accent] text-white hover:bg-[--accent-hover] shadow-sm'
                  : 'bg-[--bg-overlay] text-[--text-disabled] cursor-not-allowed'
              }
            `}
            aria-label={isSending ? 'Stop generating' : 'Send message'}
          >
            <AnimatePresence mode="wait">
              {isSending ? (
                <motion.span
                  key="stop"
                  initial={{ scale: 0.7 }} animate={{ scale: 1 }} exit={{ scale: 0.7 }}
                >
                  <Square className="w-3.5 h-3.5" />
                </motion.span>
              ) : (
                <motion.span
                  key="send"
                  initial={{ scale: 0.7 }} animate={{ scale: 1 }} exit={{ scale: 0.7 }}
                >
                  <Send className="w-3.5 h-3.5" />
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        </div>

        {/* Keyboard hint (advanced only) */}
        {!simple && !isSending && (
          <div className="absolute right-4 bottom-14 text-[10px] text-[--text-disabled] pointer-events-none">
            <kbd className="px-1 py-0.5 rounded bg-[--bg-overlay] font-mono">Enter</kbd> send
            {' · '}
            <kbd className="px-1 py-0.5 rounded bg-[--bg-overlay] font-mono">Shift+Enter</kbd> new line
          </div>
        )}
      </motion.div>

      {/* Template picker popover (advanced only) */}
      {!simple && (
        <AnimatePresence>
          {showTemplates && (
            <TemplatePicker
              onSelect={handleTemplateInsert}
              onClose={() => setShowTemplates(false)}
            />
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

// ── Quick templates picker ────────────────────────────────────────────────────

const QUICK_TEMPLATES = [
  { label: 'Summarize', content: 'Please summarize the following:\n\n' },
  { label: 'Explain code', content: 'Please explain this code step by step:\n\n```\n\n```' },
  { label: 'Write email', content: 'Write a professional email about: ' },
  { label: 'Fix bug', content: 'I have a bug in the following code. Please identify and fix it:\n\n```\n\n```' },
  { label: 'Action items', content: 'Extract all action items from the following text:\n\n' },
  { label: 'Compare options', content: 'Compare and contrast the following options:\n\n1. \n2. \n\nConsider: pros, cons, use cases, and recommendation.' },
];

function TemplatePicker({
  onSelect,
  onClose,
}: {
  onSelect: (content: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.97 }}
        transition={{ duration: 0.12 }}
        className="absolute bottom-full mb-2 left-0 right-0 z-20 bg-[--bg-elevated] border border-[--border-default] rounded-xl shadow-[--shadow-lg] p-1.5 overflow-hidden"
      >
        <p className="text-[10px] font-semibold text-[--text-tertiary] uppercase tracking-wide px-2 py-1">
          Quick Templates
        </p>
        <div className="grid grid-cols-3 gap-1">
          {QUICK_TEMPLATES.map((t) => (
            <button
              key={t.label}
              onClick={() => onSelect(t.content)}
              className="text-left px-2.5 py-2 rounded-lg hover:bg-[--bg-hover] transition-colors"
            >
              <span className="text-xs font-medium text-[--text-primary]">{t.label}</span>
            </button>
          ))}
        </div>
      </motion.div>
    </>
  );
}
