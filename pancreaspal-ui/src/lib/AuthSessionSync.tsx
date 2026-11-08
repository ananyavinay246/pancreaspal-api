import { useEffect } from 'react'
import { useAuth } from './authContext'
import { useDashboard } from './dashboardContext'

/** Refetch dashboard when guest vs signed-in patient changes. */
export function AuthSessionSync() {
  const { isAuthenticated, loading } = useAuth()
  const { refetch, clearPatientData } = useDashboard()

  useEffect(() => {
    if (loading) return
    clearPatientData()
    void refetch(false)
  }, [isAuthenticated, loading, refetch, clearPatientData])

  return null
}
