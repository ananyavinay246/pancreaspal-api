export type PatientSessionAuthBridge = {
  isAuthenticated: boolean
  getIdToken: () => Promise<string | null>
}

let bridge: PatientSessionAuthBridge = {
  isAuthenticated: false,
  getIdToken: async () => null,
}

export function setPatientSessionAuth(next: PatientSessionAuthBridge): void {
  bridge = next
}

export function getPatientSessionAuth(): PatientSessionAuthBridge {
  return bridge
}
