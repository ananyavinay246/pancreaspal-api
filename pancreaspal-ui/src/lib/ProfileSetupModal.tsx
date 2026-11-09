import React, { useState } from 'react'
import { useUserProfile } from './userProfileContext'

const T = {
  fg: '#3D3830',
  muted: '#8A8278',
  border: '#E8E2D9',
  card: '#FFFFFF',
  sage: '#7A9E87',
  danger: '#C0392B',
}

export function ProfileSetupModal() {
  const { profile, loading, saveDisplayName } = useUserProfile()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const open =
    !loading && profile != null && !(profile.display_name ?? '').trim()

  if (!open) return null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await saveDisplayName(name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your name.')
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
      aria-labelledby="profile-setup-title"
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
        <h2 id="profile-setup-title" style={{ color: T.fg }} className="text-xl font-800">
          Welcome to Pancreas Pal
        </h2>
        <p style={{ color: T.muted }} className="text-sm leading-relaxed">
          What do you want to be called? This is how we&apos;ll greet you on your home screen.
        </p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span style={{ color: T.muted }} className="text-xs font-700">
              Your name
            </span>
            <input
              type="text"
              required
              maxLength={64}
              autoComplete="nickname"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              placeholder="e.g. Maya"
              style={{ borderColor: T.border, color: T.fg }}
              className="border rounded-xl px-3 py-2 text-sm"
            />
          </label>
          {error && (
            <p style={{ color: T.danger }} className="text-xs font-600">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !name.trim()}
            style={{ backgroundColor: busy || !name.trim() ? T.border : T.sage, color: '#fff' }}
            className="rounded-xl py-2.5 text-sm font-800 cursor-pointer disabled:cursor-not-allowed"
          >
            {busy ? 'Saving…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
