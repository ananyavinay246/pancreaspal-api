/** Backend base URL (no trailing slash). Empty string uses same-origin / Vite proxy. */
export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL ?? ''
  return raw.trim().replace(/\/+$/, '')
}
