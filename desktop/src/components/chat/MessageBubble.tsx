import React, { memo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import {
  Copy, Check, RotateCcw, AlertCircle, Zap, User, Bot,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import type { ChatMessageData } from '@/types';
import { useChatStore } from '@/store/chatStore';

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className={`
        flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium
        transition-colors duration-100
        ${copied
          ? 'bg-[--color-success]/20 text-[--color-success]'
          : 'bg-[--bg-overlay] text-[--text-tertiary]'
        }
        ${className}
      `}
      aria-label="Copy to clipboard"
    >
      <AnimatePresence mode="wait">
        {copied ? (
          <motion.span
            key="check"
            initial={{ scale: 0.8 }} animate={{ scale: 1 }} exit={{ scale: 0.8 }}
            className="flex items-center gap-1"
          >
            <Check className="w-3 h-3" /> Copied
          </motion.span>
        ) : (
          <motion.span
            key="copy"
            initial={{ scale: 0.8 }} animate={{ scale: 1 }} exit={{ scale: 0.8 }}
            className="flex items-center gap-1"
          >
            <Copy className="w-3 h-3" /> Copy
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

// ── Code block ────────────────────────────────────────────────────────────────

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const lines = code.split('\n').length;

  return (
    <div className="code-block my-3 rounded-xl overflow-hidden text-sm">
      <div className="code-block-header">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-[--text-tertiary]">
            {language || 'code'}
          </span>
          {lines > 1 && (
            <span className="text-[10px] text-[--text-disabled]">{lines} lines</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {lines > 20 && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1 text-[10px] text-[--text-tertiary] hover:text-[--text-primary] transition-colors"
            >
              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {isExpanded ? 'Collapse' : 'Expand'}
            </button>
          )}
          <CopyButton text={code} />
        </div>
      </div>
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            style={{ overflow: 'hidden' }}
          >
            <SyntaxHighlighter
              language={language}
              style={oneDark}
              customStyle={{
                margin: 0,
                padding: '14px 16px',
                background: 'var(--code-bg)',
                fontSize: '12.5px',
                lineHeight: 1.65,
                maxHeight: lines > 50 ? '400px' : 'none',
                overflowY: lines > 50 ? 'auto' : 'visible',
              }}
              showLineNumbers={lines > 5}
              lineNumberStyle={{
                minWidth: '2em',
                paddingRight: '1em',
                color: 'var(--text-disabled)',
                userSelect: 'none',
              }}
            >
              {code}
            </SyntaxHighlighter>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Markdown renderer ──────────────────────────────────────────────────────────

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose-chat selectable">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            const codeStr = String(children).replace(/\n$/, '');

            if (!inline && match) {
              return <CodeBlock language={match[1]} code={codeStr} />;
            }
            return (
              <code
                className="bg-[--code-bg] border border-[--code-border] rounded px-1.5 py-0.5 text-[12.5px] font-mono"
                {...props}
              >
                {children}
              </code>
            );
          },
          // Open links externally in Tauri
          a({ href, children }) {
            return (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  if (href) (window as any).__TAURI__?.shell?.open(href);
                }}
                className="text-[--text-link] hover:underline cursor-pointer"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ── Token badge ───────────────────────────────────────────────────────────────

function TokenBadge({ tokensIn, tokensOut }: { tokensIn: number; tokensOut: number }) {
  if (tokensIn === 0 && tokensOut === 0) return null;
  return (
    <div className="flex items-center gap-1 text-[10px] text-[--text-disabled] font-mono">
      <Zap className="w-2.5 h-2.5" />
      {tokensIn > 0 && <span>{tokensIn.toLocaleString()}↑</span>}
      {tokensOut > 0 && <span>{tokensOut.toLocaleString()}↓</span>}
    </div>
  );
}

// ── Message actions ────────────────────────────────────────────────────────────

interface MessageActionsProps {
  onRegenerate?: () => void;
}

function MessageActions({ onRegenerate }: MessageActionsProps) {
  if (!onRegenerate) return null;
  return (
    <div className="flex items-center gap-1 mt-1">
      <button
        onClick={onRegenerate}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-[--bg-overlay] text-[--text-tertiary] hover:text-[--text-primary] hover:bg-[--bg-hover] transition-colors duration-100"
      >
        <RotateCcw className="w-3 h-3" /> Regenerate
      </button>
    </div>
  );
}

// ── Main MessageBubble ────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: ChatMessageData;
  onRegenerate?: () => void;
}

const MessageBubble = memo(function MessageBubble({ message, onRegenerate }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isStreaming = message.isStreaming ?? false;
  const displayContent = isStreaming
    ? (message.streamingContent ?? '')
    : message.content;
  const [copied, setCopied] = useState(false);
  const providers = useChatStore((s) => s.providers);

  // Resolve display name from providers store
  const modelDisplayName = (() => {
    if (!message.model) return null;
    for (const p of providers) {
      const m = p.models.find((m) => m.modelId === message.model);
      if (m) return m.displayName;
    }
    return message.model;
  })();

  const handleCopyBubble = useCallback(async (e: React.MouseEvent) => {
    if (isStreaming || message.hasError) return;
    const selection = window.getSelection()?.toString();
    if (selection) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('a, button')) return;
    if (!displayContent) return;

    await navigator.clipboard.writeText(displayContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [displayContent, isStreaming, message.hasError]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: [0, 0, 0.2, 1] }}
      className={`flex gap-3 px-4 py-3 group ${isUser ? 'flex-row-reverse' : ''}`}
    >
      {/* Avatar */}
      <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 ${
        isUser
          ? 'bg-[--accent] text-white'
          : 'bg-[--bg-overlay] text-[--text-secondary] border border-[--border-subtle]'
      }`}>
        {isUser
          ? <User className="w-3.5 h-3.5" />
          : <Bot className="w-3.5 h-3.5" />
        }
      </div>

      {/* Content */}
      <div className={`flex-1 min-w-0 max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        {/* Message bubble */}
        <div
          onClick={handleCopyBubble}
          title="Click to copy"
          className={`
          relative rounded-2xl px-3.5 py-2.5
          ${(!isStreaming && !message.hasError) ? 'cursor-copy' : ''}
          ${isUser
            ? 'bg-[--accent] text-white rounded-tr-sm'
            : 'bg-[--bg-elevated] text-[--text-primary] rounded-tl-sm border border-[--border-subtle]'
          }
        `}
        >
          {message.hasError ? (
            <div className="flex items-center gap-2 text-[--color-error] text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{message.errorMessage ?? 'Something went wrong. Please try again.'}</span>
            </div>
          ) : isUser ? (
            <p className="text-sm leading-relaxed selectable whitespace-pre-wrap break-words">
              {displayContent}
            </p>
          ) : (
            <div className={isStreaming && !displayContent ? 'h-5 flex items-center' : ''}>
              {isStreaming && !displayContent ? (
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-[--text-tertiary]"
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                    />
                  ))}
                </div>
              ) : (
                <div className={isStreaming ? 'streaming-cursor' : ''}>
                  <MarkdownContent content={displayContent} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Meta row */}
        <div className={`flex items-center gap-2 mt-1 px-0.5 ${isUser ? 'flex-row-reverse' : ''}`}>
          <span className="text-[10px] text-[--text-disabled]">
            {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {copied && (
            <span className="text-[10px] text-[--text-tertiary]">
              Copied
            </span>
          )}
          {!isUser && (
            <TokenBadge tokensIn={message.tokensIn} tokensOut={message.tokensOut} />
          )}
          {message.model && (
            <span className="text-[10px] text-[--text-disabled] font-mono">{modelDisplayName}</span>
          )}
        </div>

        {/* Actions */}
        {!isStreaming && !message.hasError && (
          <MessageActions onRegenerate={!isUser ? onRegenerate : undefined} />
        )}
      </div>
    </motion.div>
  );
});

export default MessageBubble;
