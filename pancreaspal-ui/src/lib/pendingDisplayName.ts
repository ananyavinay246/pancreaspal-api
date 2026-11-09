const PENDING_DISPLAY_NAME_KEY = 'pendingDisplayName'

export function setPendingDisplayName(name: string): void {
  const trimmed = name.trim()
  if (trimmed) localStorage.setItem(PENDING_DISPLAY_NAME_KEY, trimmed)
}

export function clearPendingDisplayName(): void {
  localStorage.removeItem(PENDING_DISPLAY_NAME_KEY)
}

export function readPendingDisplayName(): string | null {
  const v = (localStorage.getItem(PENDING_DISPLAY_NAME_KEY) ?? '').trim()
  return v || null
}
