import React from 'react';
import { motion } from 'framer-motion';
import { Wifi, WifiOff } from 'lucide-react';
import { useUIStore } from '@/store/uiStore';

// Detect platform for native window controls
const isMacOS = navigator.platform.toLowerCase().includes('mac');
const isWindows = navigator.platform.toLowerCase().includes('win');

function MacOSControls() {
  // Tauri: use window.__TAURI__.window.getCurrent() to close/minimize/maximize
  const handleClose = () => {
    (window as any).__TAURI__?.window?.getCurrent()?.close();
  };
  const handleMinimize = () => {
    (window as any).__TAURI__?.window?.getCurrent()?.minimize();
  };
  const handleMaximize = () => {
    (window as any).__TAURI__?.window?.getCurrent()?.toggleMaximize();
  };

  return (
    <div className="flex items-center gap-1.5 titlebar-no-drag px-3">
      <button
        onClick={handleClose}
        className="group w-3 h-3 rounded-full bg-[#FF5F57] hover:bg-[#FF5F57] flex items-center justify-center transition-colors"
        aria-label="Close"
      >
        <span className="hidden group-hover:block text-[#4A0004] text-[8px] font-bold leading-none">✕</span>
      </button>
      <button
        onClick={handleMinimize}
        className="group w-3 h-3 rounded-full bg-[#FFBD2E] flex items-center justify-center transition-colors"
        aria-label="Minimize"
      >
        <span className="hidden group-hover:block text-[#4A3000] text-[8px] font-bold leading-none">−</span>
      </button>
      <button
        onClick={handleMaximize}
        className="group w-3 h-3 rounded-full bg-[#28C840] flex items-center justify-center transition-colors"
        aria-label="Maximize"
      >
        <span className="hidden group-hover:block text-[#003600] text-[8px] font-bold leading-none">+</span>
      </button>
    </div>
  );
}

function WindowsControls() {
  return (
    <div className="flex items-center titlebar-no-drag">
      <button
        onClick={() => (window as any).__TAURI__?.window?.getCurrent()?.minimize()}
        className="w-10 h-8 flex items-center justify-center hover:bg-[rgba(255,255,255,0.08)] transition-colors"
        aria-label="Minimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor" className="text-[--text-secondary]">
          <rect width="10" height="1"/>
        </svg>
      </button>
      <button
        onClick={() => (window as any).__TAURI__?.window?.getCurrent()?.toggleMaximize()}
        className="w-10 h-8 flex items-center justify-center hover:bg-[rgba(255,255,255,0.08)] transition-colors"
        aria-label="Maximize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" className="text-[--text-secondary]">
          <rect x="0.5" y="0.5" width="9" height="9" strokeWidth="1"/>
        </svg>
      </button>
      <button
        onClick={() => (window as any).__TAURI__?.window?.getCurrent()?.close()}
        className="w-10 h-8 flex items-center justify-center hover:bg-[#E81123] hover:text-white transition-colors"
        aria-label="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" className="text-[--text-secondary]">
          <path d="M1 1L9 9M9 1L1 9" strokeWidth="1"/>
        </svg>
      </button>
    </div>
  );
}

interface TitleBarProps {
  title?: string;
  isConnected?: boolean;
}

export default function TitleBar({ title = 'Company AI', isConnected = true }: TitleBarProps) {
  return (
    <div
      className="titlebar-drag flex items-center h-8 border-b border-[--border-subtle] flex-shrink-0 relative bg-[--bg-base]"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* macOS controls (left side) */}
      {isMacOS && <MacOSControls />}

      {/* App title — centered */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="text-[--text-tertiary] text-[11px] font-medium tracking-wide select-none">
          {title}
        </span>
      </div>

      {/* Connection status (right side) */}
      <div className="ml-auto mr-3 titlebar-no-drag flex items-center gap-1.5">
        <motion.div
          initial={false}
          animate={{ opacity: 1 }}
          className="flex items-center gap-1"
        >
          {isConnected ? (
            <div className="w-1.5 h-1.5 rounded-full bg-[--color-success]" />
          ) : (
            <div className="w-1.5 h-1.5 rounded-full bg-[--color-error] animate-pulse" />
          )}
        </motion.div>
      </div>

      {/* Windows controls (right side) */}
      {isWindows && <WindowsControls />}
    </div>
  );
}
