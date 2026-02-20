import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, ChevronDown, Zap, TrendingUp, Moon, Sun, Monitor } from 'lucide-react';
import { useUIStore } from '@/store/uiStore';
import { useChatStore } from '@/store/chatStore';
import { useAuthStore } from '@/store/authStore';
import type { Theme, AccentColor } from '@/types';

// ── Section component ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-semibold text-[--text-tertiary] uppercase tracking-wider px-1">
        {title}
      </h3>
      {children}
    </div>
  );
}

// ── Provider + Model selector ─────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  openai: '#10a37f',
  anthropic: '#d4763b',
  gemini: '#4285f4',
};

function ModelSelector() {
  const { providers, activeSession, selectedProvider, selectedModel, setModel } = useChatStore();
  const [open, setOpen] = useState<string | null>(null);

  if (providers.length === 0) {
    return (
      <div className="space-y-2">
        {['openai', 'anthropic', 'gemini'].map((p) => (
          <div key={p} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[--bg-overlay]">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PROVIDER_COLORS[p] }} />
            <div className="skeleton flex-1 h-3 rounded" />
          </div>
        ))}
      </div>
    );
  }

  const current = activeSession
    ? { provider: activeSession.provider, model: activeSession.model }
    : { provider: selectedProvider, model: selectedModel };

  return (
    <div className="space-y-1">
      {providers.map((provider) => (
        <div key={provider.id}>
          <button
            onClick={() => setOpen(open === provider.id ? null : provider.id)}
            disabled={!provider.isEnabled}
            className={`
              w-full flex items-center gap-2 px-3 py-2.5 rounded-xl
              transition-colors text-left
              ${provider.isEnabled
                ? 'hover:bg-[--bg-hover] text-[--text-secondary]'
                : 'opacity-40 cursor-not-allowed'
              }
              ${current.provider === provider.name ? 'bg-[--bg-hover]' : ''}
            `}
          >
            <div
              className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-[10px] font-bold"
              style={{ backgroundColor: PROVIDER_COLORS[provider.name] ?? '#888' }}
            >
              {provider.displayName[0]}
            </div>
            <span className="flex-1 text-xs font-medium text-[--text-primary]">
              {provider.displayName}
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${open === provider.id ? 'rotate-180' : ''}`}
            />
          </button>

          {open === provider.id && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="ml-3 mt-0.5 space-y-0.5 pb-1 border-l border-[--border-subtle] pl-3">
                {provider.models
                  .filter((m) => m.isEnabled)
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((m) => {
                    const isActive = current.provider === provider.name && current.model === m.modelId;
                    return (
                      <button
                        key={m.id}
                        onClick={() => setModel(provider.name, m.modelId)}
                        className={`
                          w-full flex items-center gap-2 px-2 py-1.5 rounded-lg
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
                  })}
              </div>
            </motion.div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Usage bars ─────────────────────────────────────────────────────────────────

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min(1, used / (limit || 1));
  const color = pct > 0.9 ? 'var(--color-error)' : pct > 0.7 ? 'var(--color-warning)' : 'var(--accent)';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[--text-tertiary]">{label}</span>
        <span className="font-mono text-[--text-secondary]">
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[--bg-overlay] overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct * 100}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ── Theme selector ─────────────────────────────────────────────────────────────

function ThemeToggle() {
  const { theme, setTheme } = useUIStore();
  const options: { value: Theme; icon: React.ReactNode; label: string }[] = [
    { value: 'dark', icon: <Moon className="w-3.5 h-3.5" />, label: 'Dark' },
    { value: 'system', icon: <Monitor className="w-3.5 h-3.5" />, label: 'Auto' },
    { value: 'light', icon: <Sun className="w-3.5 h-3.5" />, label: 'Light' },
  ];

  return (
    <div className="flex rounded-xl bg-[--bg-overlay] p-0.5 gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setTheme(opt.value)}
          className={`
            flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg
            text-xs font-medium transition-all duration-150
            ${theme === opt.value
              ? 'bg-[--bg-surface] text-[--text-primary] shadow-[--shadow-sm]'
              : 'text-[--text-tertiary] hover:text-[--text-primary]'
            }
          `}
        >
          {opt.icon}
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Accent color picker ────────────────────────────────────────────────────────

const ACCENT_COLORS: { value: AccentColor; color: string }[] = [
  { value: 'blue',   color: '#3B82F6' },
  { value: 'purple', color: '#8B5CF6' },
  { value: 'green',  color: '#22C55E' },
  { value: 'orange', color: '#F97316' },
  { value: 'pink',   color: '#EC4899' },
];

function AccentPicker() {
  const { accentColor, setAccentColor } = useUIStore();
  return (
    <div className="flex gap-2">
      {ACCENT_COLORS.map((c) => (
        <button
          key={c.value}
          onClick={() => setAccentColor(c.value)}
          className="relative w-7 h-7 rounded-full transition-transform hover:scale-110"
          style={{ backgroundColor: c.color }}
          aria-label={`${c.value} accent`}
        >
          {accentColor === c.value && (
            <span className="absolute inset-0 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20,6 9,17 4,12"/>
              </svg>
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Main SettingsPanel ─────────────────────────────────────────────────────────

export default function SettingsPanel() {
  const { toggleSettingsPanel } = useUIStore();
  const { activeSession, providers } = useChatStore();
  const { quota } = useAuthStore();

  return (
    <div className="flex flex-col h-full bg-[--bg-surface] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[--border-subtle] flex-shrink-0">
        <h2 className="text-sm font-semibold text-[--text-primary]">Settings</h2>
        <button
          onClick={toggleSettingsPanel}
          className="w-6 h-6 flex items-center justify-center rounded-md text-[--text-tertiary] hover:text-[--text-primary] hover:bg-[--bg-hover] transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Model selection */}
        <Section title="AI Model">
          <ModelSelector />
        </Section>

        {/* Session usage */}
        {activeSession && (
          <Section title="Session Usage">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[--text-tertiary]">Tokens in</span>
                <span className="font-mono text-[--text-secondary]">
                  {(activeSession.totalTokensIn ?? 0).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[--text-tertiary]">Tokens out</span>
                <span className="font-mono text-[--text-secondary]">
                  {(activeSession.totalTokensOut ?? 0).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[--text-tertiary]">Messages</span>
                <span className="font-mono text-[--text-secondary]">{activeSession.messageCount}</span>
              </div>
            </div>
          </Section>
        )}

        {/* Quota */}
        {quota && (
          <Section title="Token Quota">
            <div className="space-y-3">
              <UsageBar
                label="Today"
                used={quota.dailyTokensUsed}
                limit={quota.dailyTokenLimit}
              />
              <UsageBar
                label="This month"
                used={quota.monthlyTokensUsed}
                limit={quota.monthlyTokenLimit}
              />
            </div>
          </Section>
        )}

        {/* Appearance */}
        <Section title="Appearance">
          <div className="space-y-3">
            <ThemeToggle />
            <div>
              <p className="text-[11px] text-[--text-tertiary] mb-2">Accent color</p>
              <AccentPicker />
            </div>
          </div>
        </Section>

        {/* Ephemeral toggle (for active session) */}
        {activeSession && (
          <Section title="Privacy">
            <label className="flex items-center justify-between py-2 cursor-pointer">
              <div>
                <p className="text-xs font-medium text-[--text-primary]">Ephemeral mode</p>
                <p className="text-[11px] text-[--text-tertiary]">
                  Messages won't be stored after session ends
                </p>
              </div>
              <div className={`
                relative w-9 h-5 rounded-full transition-colors cursor-pointer
                ${activeSession.isEphemeral ? 'bg-[--accent]' : 'bg-[--bg-overlay]'}
              `}>
                <div className={`
                  absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform
                  ${activeSession.isEphemeral ? 'translate-x-4' : 'translate-x-0.5'}
                `} />
              </div>
            </label>
          </Section>
        )}
      </div>
    </div>
  );
}
