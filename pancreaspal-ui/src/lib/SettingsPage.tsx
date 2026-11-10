import React, { useEffect, useState } from 'react'
import { useAuth } from './authContext'
import { useUserProfile } from './userProfileContext'

const T = {
  sage: '#7FA68C',
  card: '#FFFFFF',
  bg: '#F8F5F1',
  muted: '#9B968E',
  border: '#E8E3DC',
  fg: '#3D3830',
  danger: '#C0392B',
}

export function SettingsPage() {
  const auth = useAuth()
  const { profile, loading, saveDisplayName } = useUserProfile()
  const [name, setName] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName(profile?.display_name?.trim() ?? '')
  }, [profile?.display_name])

  if (!auth.isAuthenticated) {
    return (
      <main className="max-w-lg mx-auto page-pad py-12">
        <p style={{ color: T.muted }} className="text-sm font-600">
          Sign in to view and edit your profile.
        </p>
        <button
          type="button"
          onClick={() => auth.openAuth('signIn')}
          style={{ backgroundColor: T.sage, color: '#fff' }}
          className="mt-4 rounded-xl px-4 py-2 text-sm font-800 cursor-pointer"
        >
          Sign in
        </button>
      </main>
    )
  }

  const email = profile?.email ?? auth.email ?? '—'

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaved(false)
    setBusy(true)
    try {
      await saveDisplayName(name)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="max-w-lg mx-auto page-pad py-8 sm:py-10 flex flex-col gap-8">
      <div>
        <h1 style={{ color: T.fg }} className="text-2xl sm:text-3xl font-800 tracking-tight">
          Settings
        </h1>
        <p style={{ color: T.muted }} className="text-sm font-500 mt-1">
          Your account details
        </p>
      </div>

      <form
        onSubmit={onSave}
        style={{
          backgroundColor: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 16,
          boxShadow: '0 1px 8px rgba(61,56,48,0.06)',
        }}
        className="p-6 flex flex-col gap-5"
      >
        <label className="flex flex-col gap-1.5">
          <span style={{ color: T.muted }} className="text-xs font-700 uppercase tracking-wide">
            What you&apos;re called
          </span>
          <input
            type="text"
            required
            maxLength={64}
            autoComplete="nickname"
            value={name}
            onChange={(ev) => {
              setName(ev.target.value)
              setSaved(false)
            }}
            disabled={loading || busy}
            style={{ borderColor: T.border, color: T.fg }}
            className="border rounded-xl px-3 py-2 text-sm"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span style={{ color: T.muted }} className="text-xs font-700 uppercase tracking-wide">
            Email
          </span>
          <p style={{ color: T.fg }} className="text-sm font-600">
            {email}
          </p>
          <p style={{ color: T.muted }} className="text-xs leading-relaxed">
            Email is tied to your sign-in and isn&apos;t editable here. If you need to change it,
            use AWS Cognito account recovery or contact support — a new address must be verified.
          </p>
        </div>

        {error && (
          <p style={{ color: T.danger }} className="text-xs font-600">
            {error}
          </p>
        )}
        {saved && (
          <p style={{ color: T.sage }} className="text-xs font-700">
            Saved.
          </p>
        )}

        <button
          type="submit"
          disabled={busy || loading || !name.trim()}
          style={{
            backgroundColor: busy || loading || !name.trim() ? T.border : T.sage,
            color: '#fff',
          }}
          className="rounded-xl py-2.5 text-sm font-800 cursor-pointer disabled:cursor-not-allowed"
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </main>
  )
}
