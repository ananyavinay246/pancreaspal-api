import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getDashboard, PatientApiError } from './api/patientApi'
import type { DashboardPayload } from './api/dashboardTypes'
import { ensurePatientId } from './patientSession'

type DashboardContextValue = {
  dashboard: DashboardPayload | null
  loading: boolean
  error: string | null
  refetch: (refresh?: boolean) => Promise<void>
}

const DashboardContext = createContext<DashboardContextValue | null>(null)

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async (refresh = false) => {
    setError(null)
    try {
      const patientId = await ensurePatientId()
      const data = await getDashboard(patientId, 14, refresh)
      setDashboard(data)
    } catch (err) {
      const msg =
        err instanceof PatientApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to load dashboard'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refetch(false)
  }, [refetch])

  const value = useMemo(
    () => ({ dashboard, loading, error, refetch }),
    [dashboard, loading, error, refetch],
  )

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
}

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext)
  if (!ctx) {
    throw new Error('useDashboard must be used within DashboardProvider')
  }
  return ctx
}
