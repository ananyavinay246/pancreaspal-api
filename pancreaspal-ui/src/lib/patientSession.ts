import { initPatient } from './api/patientApi'

const STORAGE_KEY = 'currentPatientId'

/** When set at Amplify build time, every visitor shares this patient (see seed_demo_patient.py). */
const DEMO_PATIENT_ID = (import.meta.env.VITE_DEMO_PATIENT_ID ?? '').trim()

let initPromise: Promise<string> | null = null

export function isDemoPatientMode(): boolean {
  return DEMO_PATIENT_ID.length > 0
}

export function getDemoPatientId(): string | null {
  return DEMO_PATIENT_ID || null
}

export function getStoredPatientId(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function setStoredPatientId(patientId: string): void {
  localStorage.setItem(STORAGE_KEY, patientId)
}

export function clearStoredPatientId(): void {
  localStorage.removeItem(STORAGE_KEY)
  initPromise = null
}

/** Returns a patient_id with an empty chart record; reuses localStorage when present. */
export async function ensurePatientId(): Promise<string> {
  if (DEMO_PATIENT_ID) return DEMO_PATIENT_ID

  const existing = getStoredPatientId()
  if (existing) return existing

  if (!initPromise) {
    initPromise = initPatient().then((id) => {
      setStoredPatientId(id)
      return id
    })
  }
  return initPromise
}
