import { fetchMe, initPatient } from './api/patientApi'
import { getPatientSessionAuth } from './patientSessionAuth'

const STORAGE_KEY = 'currentPatientId'

/** When set at Amplify build time, every visitor shares this patient (see seed_demo_patient.py). */
const DEMO_PATIENT_ID = (import.meta.env.VITE_DEMO_PATIENT_ID ?? '').trim()

let initPromise: Promise<string> | null = null
let privatePatientId: string | null = null
let privatePatientPromise: Promise<string> | null = null

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

export function clearPrivatePatientCache(): void {
  privatePatientId = null
  privatePatientPromise = null
}

/** Returns patient_id for the current guest or signed-in user. */
export async function ensurePatientId(): Promise<string> {
  const { isAuthenticated } = getPatientSessionAuth()

  if (isAuthenticated) {
    if (privatePatientId) return privatePatientId
    if (!privatePatientPromise) {
      privatePatientPromise = fetchMe().then((me) => {
        privatePatientId = me.patient_id
        return me.patient_id
      })
    }
    return privatePatientPromise
  }

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
