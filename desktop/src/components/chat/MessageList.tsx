import React, { useEffect, useRef, useCallback, memo } from 'react';
import { VariableSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { motion } from 'framer-motion';
import MessageBubble from './MessageBubble';
import { useUIStore } from '@/store/uiStore';
import type { ChatMessageData } from '@/types';

// ── Simple empty state ──────────────────────────────────────────────────────────

function SimpleEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full pb-16 select-none">
      <p className="text-sm text-[--text-tertiary]">Type a message below to get started</p>
    </div>
  );
}

// ── Advanced empty state ────────────────────────────────────────────────────────

function AdvancedEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 pb-16 select-none">
      <div className="relative">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[--accent]/20 to-[--accent]/5 border border-[--accent]/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-[--accent]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[--accent] flex items-center justify-center">
          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
          </svg>
        </div>
      </div>

      <div className="text-center space-y-1.5">
        <h3 className="text-base font-semibold text-[--text-primary]">Start a conversation</h3>
        <p className="text-sm text-[--text-tertiary] max-w-xs leading-snug">
          Ask anything — write code, analyze data, draft documents, or just chat.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 max-w-sm w-full px-4">
        {[
          { label: 'Write & edit', desc: 'Drafts, emails, docs' },
          { label: 'Code', desc: 'Debug, review, generate' },
          { label: 'Research', desc: 'Summarize & analyze' },
          { label: 'Brainstorm', desc: 'Ideas & strategies' },
        ].map((tip) => (
          <div
            key={tip.label}
            className="p-2.5 rounded-xl bg-[--bg-elevated] border border-[--border-subtle] hover:border-[--border-default] transition-colors cursor-pointer"
          >
            <p className="text-xs font-medium text-[--text-primary]">{tip.label}</p>
            <p className="text-[11px] text-[--text-tertiary] mt-0.5">{tip.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Virtualized list ──────────────────────────────────────────────────────────

interface MessageListProps {
  messages: ChatMessageData[];
  isLoading?: boolean;
  onRegenerate?: (messageId: string) => void;
}

// Fixed heights for estimation (actual height varies with content length)
const ESTIMATE_HEIGHT = 120;

const MessageListInner = memo(function MessageListInner({
  messages,
  isLoading,
  onRegenerate,
  width,
  height,
}: MessageListProps & { width: number; height: number }) {
  const listRef = useRef<List>(null);
  const heightMapRef = useRef<Record<number, number>>({});
  const prevLengthRef = useRef(0);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > prevLengthRef.current) {
      listRef.current?.scrollToItem(messages.length - 1, 'end');
    }
    prevLengthRef.current = messages.length;
  }, [messages.length]);

  // Re-measure streaming messages (content grows)
  const streamingIdx = messages.findLastIndex((m) => m.isStreaming);
  useEffect(() => {
    if (streamingIdx !== -1) {
      listRef.current?.resetAfterIndex(streamingIdx);
      listRef.current?.scrollToItem(messages.length - 1, 'end');
    }
  }, [streamingIdx, messages]);

  const getItemSize = useCallback(
    (index: number) => heightMapRef.current[index] ?? ESTIMATE_HEIGHT,
    [],
  );

  const setItemHeight = useCallback((index: number, height: number) => {
    if (heightMapRef.current[index] !== height) {
      heightMapRef.current[index] = height;
      listRef.current?.resetAfterIndex(index, false);
    }
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="skeleton w-7 h-7 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-4 w-2/3 rounded" />
              <div className="skeleton h-4 w-1/2 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <List
      ref={listRef}
      height={height}
      width={width}
      itemCount={messages.length}
      itemSize={getItemSize}
      overscanCount={5}
    >
      {({ index, style }) => {
        const msg = messages[index];
        return (
          <div
            style={style}
            ref={(el) => {
              if (el) {
                const h = el.getBoundingClientRect().height;
                if (h > 0) setItemHeight(index, h);
              }
            }}
          >
            <MessageBubble
              message={msg}
              onRegenerate={
                msg.role === 'assistant' && onRegenerate
                  ? () => onRegenerate(msg.id)
                  : undefined
              }
            />
          </div>
        );
      }}
    </List>
  );
});

export default function MessageList({
  messages,
  isLoading,
  onRegenerate,
}: MessageListProps) {
  const { chatViewMode } = useUIStore();

  if (!isLoading && messages.length === 0) {
    return chatViewMode === 'simple' ? <SimpleEmptyState /> : <AdvancedEmptyState />;
  }

  return (
    <div className="flex-1 min-h-0">
      <AutoSizer>
        {({ width, height }) => (
          <MessageListInner
            messages={messages}
            isLoading={isLoading}
            onRegenerate={onRegenerate}
            width={width}
            height={height}
          />
        )}
      </AutoSizer>
    </div>
  );
}
