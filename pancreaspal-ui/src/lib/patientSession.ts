import { initPatient } from './api/patientApi'

const STORAGE_KEY = 'currentPatientId'

let initPromise: Promise<string> | null = null

export function getStoredPatientId(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function setStoredPatientId(patientId: string): void {
  localStorage.setItem(STORAGE_KEY, patientId)
}

/** Returns a patient_id with an empty chart record; reuses localStorage when present. */
export async function ensurePatientId(): Promise<string> {
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
