import React, { useState } from 'react'
import { useAuth, type AuthView } from './authContext'

const T = {
  fg: '#3D3830',
  muted: '#8A8278',
  border: '#E8E2D9',
  card: '#FFFFFF',
  sage: '#7A9E87',
  danger: '#C0392B',
}

type Props = {
  view: AuthView
  onClose: () => void
}

export function AuthModal({ view, onClose }: Props) {
  const auth = useAuth()
  const [email, setEmail] = useState(auth.pendingSignUpEmail || auth.email || '')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const title: Record<AuthView, string> = {
    signIn: 'Sign in',
    signUp: 'Create account',
    confirmSignUp: 'Verify your email',
    forgotPassword: 'Reset password',
    confirmReset: 'Choose a new password',
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (view === 'signIn') {
        await auth.signInWithPassword(email, password)
      } else if (view === 'signUp') {
        await auth.signUpWithPassword(email, password)
      } else if (view === 'confirmSignUp') {
        await auth.confirmSignUpCode(code)
      } else if (view === 'forgotPassword') {
        await auth.forgotPassword(email)
      } else if (view === 'confirmReset') {
        await auth.confirmForgotPassword(code, newPassword)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ backgroundColor: 'rgba(61,56,48,0.45)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div
        style={{
          backgroundColor: T.card,
          borderRadius: 20,
          border: `1px solid ${T.border}`,
          boxShadow: '0 8px 32px rgba(61,56,48,0.12)',
          maxWidth: 400,
          width: '100%',
        }}
        className="p-8 flex flex-col gap-4"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="auth-modal-title" style={{ color: T.fg }} className="text-xl font-800">
            {title[view]}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{ color: T.muted }}
            className="text-sm font-700 cursor-pointer"
          >
            Close
          </button>
        </div>

        {view === 'signUp' && (
          <p style={{ color: T.muted }} className="text-xs leading-relaxed">
            Your private account starts fresh. Activity in the shared demo is not copied to your account.
          </p>
        )}

        {view === 'confirmSignUp' && (
          <p style={{ color: T.muted }} className="text-xs">
            Enter the verification code sent to {auth.pendingSignUpEmail || 'your email'}.
          </p>
        )}

        <form onSubmit={submit} className="flex flex-col gap-3">
          {(view === 'signIn' || view === 'signUp' || view === 'forgotPassword') && (
            <label className="flex flex-col gap-1">
              <span style={{ color: T.muted }} className="text-xs font-700">
                Email
              </span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                style={{ borderColor: T.border, color: T.fg }}
                className="border rounded-xl px-3 py-2 text-sm"
              />
            </label>
          )}

          {(view === 'signIn' || view === 'signUp') && (
            <label className="flex flex-col gap-1">
              <span style={{ color: T.muted }} className="text-xs font-700">
                Password
              </span>
              <input
                type="password"
                required
                autoComplete={view === 'signUp' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                style={{ borderColor: T.border, color: T.fg }}
                className="border rounded-xl px-3 py-2 text-sm"
              />
            </label>
          )}

          {(view === 'confirmSignUp' || view === 'confirmReset') && (
            <label className="flex flex-col gap-1">
              <span style={{ color: T.muted }} className="text-xs font-700">
                Verification code
              </span>
              <input
                type="text"
                required
                inputMode="numeric"
                value={code}
                onChange={(ev) => setCode(ev.target.value)}
                style={{ borderColor: T.border, color: T.fg }}
                className="border rounded-xl px-3 py-2 text-sm"
              />
            </label>
          )}

          {view === 'confirmReset' && (
            <label className="flex flex-col gap-1">
              <span style={{ color: T.muted }} className="text-xs font-700">
                New password
              </span>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={newPassword}
                onChange={(ev) => setNewPassword(ev.target.value)}
                style={{ borderColor: T.border, color: T.fg }}
                className="border rounded-xl px-3 py-2 text-sm"
              />
            </label>
          )}

          {error && (
            <p style={{ color: T.danger }} className="text-xs font-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{ backgroundColor: busy ? T.border : T.sage, color: '#fff' }}
            className="rounded-xl py-2.5 text-sm font-800 cursor-pointer disabled:cursor-not-allowed"
          >
            {busy ? 'Please wait…' : 'Continue'}
          </button>
        </form>

        <div className="flex flex-col gap-2 text-xs font-700" style={{ color: T.muted }}>
          {view === 'signIn' && (
            <>
              <button type="button" className="text-left cursor-pointer" onClick={() => auth.openAuth('signUp')}>
                Create account
              </button>
              <button type="button" className="text-left cursor-pointer" onClick={() => auth.openAuth('forgotPassword')}>
                Forgot password?
              </button>
            </>
          )}
          {(view === 'signUp' || view === 'forgotPassword' || view === 'confirmSignUp' || view === 'confirmReset') && (
            <button type="button" className="text-left cursor-pointer" onClick={() => auth.openAuth('signIn')}>
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
