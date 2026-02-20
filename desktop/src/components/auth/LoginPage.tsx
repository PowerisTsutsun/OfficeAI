import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, ArrowRight, CheckCircle, AlertCircle, Loader2, Bot, LogIn } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

type Step = 'email' | 'sent' | 'verifying' | 'error';

interface LoginPageProps {
  /** If a magic link token is in the URL, pass it here to auto-verify */
  verifyToken?: string;
}

export default function LoginPage({ verifyToken }: LoginPageProps) {
  const [step, setStep] = useState<Step>(verifyToken ? 'verifying' : 'email');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const { requestMagicLink, verifyMagicLink, devLogin, isLoading, error } = useAuthStore();

  // Auto-verify if token provided
  useEffect(() => {
    if (verifyToken) {
      setStep('verifying');
      verifyMagicLink(verifyToken).catch((e) => {
        setErrorMsg(e.detail ?? e.message ?? 'Verification failed');
        setStep('error');
      });
    }
  }, [verifyToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      await requestMagicLink(email);
      setStep('sent');
    } catch (e: any) {
      setErrorMsg(e.detail ?? e.message ?? 'Failed to send magic link');
    }
  };

  const handleDevLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      await devLogin(username, password);
    } catch (e: any) {
      setErrorMsg(e.detail ?? e.message ?? 'Invalid credentials');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[--bg-base] p-4">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-[--accent]/5 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0, 0, 0.2, 1] }}
        className="w-full max-w-sm"
      >
        {/* Logo + title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-[--accent] to-[--accent-hover] shadow-[var(--shadow-glow)] mb-4">
            <Bot className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-[--text-primary]">Company AI</h1>
          <p className="text-sm text-[--text-tertiary] mt-1">Sign in to continue</p>
        </div>

        {/* Card */}
        <div className="bg-[--bg-surface] border border-[--border-subtle] rounded-2xl p-6 shadow-[--shadow-lg]">
          <AnimatePresence mode="wait">
            {/* Email input step */}
            {step === 'email' && (
              <motion.div
                key="email"
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ duration: 0.2 }}
              >
                {/* Dev login form */}
                <form onSubmit={handleDevLogin} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-[--text-secondary] mb-1.5">
                      Username
                    </label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="admin"
                      required
                      autoFocus
                      className="
                        w-full px-3 py-2.5 rounded-xl
                        bg-[--bg-elevated] border border-[--border-subtle]
                        text-sm text-[--text-primary] placeholder:text-[--text-tertiary]
                        focus:outline-none focus:border-[--accent]
                        transition-colors selectable
                      "
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[--text-secondary] mb-1.5">
                      Password
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="password"
                      required
                      className="
                        w-full px-3 py-2.5 rounded-xl
                        bg-[--bg-elevated] border border-[--border-subtle]
                        text-sm text-[--text-primary] placeholder:text-[--text-tertiary]
                        focus:outline-none focus:border-[--accent]
                        transition-colors selectable
                      "
                    />
                  </div>

                  {/* Error */}
                  <AnimatePresence>
                    {errorMsg && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-center gap-2 text-sm text-[--color-error] bg-[--color-error]/10 rounded-xl px-3 py-2"
                      >
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>{errorMsg}</span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <button
                    type="submit"
                    disabled={isLoading || !username || !password}
                    className="
                      w-full flex items-center justify-center gap-2
                      px-4 py-2.5 rounded-xl
                      bg-[--accent] hover:bg-[--accent-hover]
                      text-white text-sm font-semibold
                      transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                      shadow-sm
                    "
                  >
                    {isLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <LogIn className="w-4 h-4" />
                        <span>Sign in</span>
                      </>
                    )}
                  </button>
                </form>

                <div className="mt-4 text-center">
                  <p className="text-[11px] text-[--text-tertiary] leading-relaxed">
                    Dev mode — use <span className="font-mono text-[--text-secondary]">admin</span> / <span className="font-mono text-[--text-secondary]">admin123</span>
                  </p>
                </div>
              </motion.div>
            )}

            {/* Link sent step */}
            {step === 'sent' && (
              <motion.div
                key="sent"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="text-center py-4"
              >
                <motion.div
                  initial={{ scale: 0.5 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
                  className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[--color-success]/15 border border-[--color-success]/30 mb-4"
                >
                  <Mail className="w-7 h-7 text-[--color-success]" />
                </motion.div>
                <h3 className="text-base font-semibold text-[--text-primary] mb-1">Check your email</h3>
                <p className="text-sm text-[--text-tertiary] mb-1">
                  We sent a magic link to
                </p>
                <p className="text-sm font-medium text-[--text-primary] mb-4">{email}</p>
                <p className="text-[11px] text-[--text-tertiary]">
                  The link expires in 10 minutes.{' '}
                  <button
                    onClick={() => setStep('email')}
                    className="text-[--accent] hover:underline"
                  >
                    Try a different email
                  </button>
                </p>
              </motion.div>
            )}

            {/* Verifying step */}
            {step === 'verifying' && (
              <motion.div
                key="verifying"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center gap-3 py-8"
              >
                <Loader2 className="w-8 h-8 text-[--accent] animate-spin" />
                <p className="text-sm text-[--text-secondary]">Signing you in...</p>
              </motion.div>
            )}

            {/* Error step */}
            {step === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-4"
              >
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[--color-error]/15 border border-[--color-error]/30 mb-4">
                  <AlertCircle className="w-7 h-7 text-[--color-error]" />
                </div>
                <h3 className="text-base font-semibold text-[--text-primary] mb-1">Sign in failed</h3>
                <p className="text-sm text-[--text-tertiary] mb-4">{errorMsg}</p>
                <button
                  onClick={() => { setStep('email'); setErrorMsg(''); }}
                  className="px-4 py-2 rounded-xl bg-[--bg-elevated] border border-[--border-subtle] text-sm text-[--text-secondary] hover:text-[--text-primary] hover:border-[--border-default] transition-colors"
                >
                  Try again
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <p className="text-center text-[10px] text-[--text-disabled] mt-6">
          Access restricted to authorized company users
        </p>
      </motion.div>
    </div>
  );
}
