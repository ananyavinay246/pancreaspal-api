import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { fetchMe, updateMyProfile, type MeResponse } from './api/patientApi'
import { useAuth } from './authContext'
import { clearPendingDisplayName, readPendingDisplayName } from './pendingDisplayName'

type UserProfileContextValue = {
  profile: MeResponse | null
  loading: boolean
  refreshProfile: () => Promise<void>
  saveDisplayName: (name: string) => Promise<void>
}

const UserProfileContext = createContext<UserProfileContextValue | null>(null)

export function UserProfileProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [profile, setProfile] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const refreshProfile = useCallback(async () => {
    if (!isAuthenticated) {
      setProfile(null)
      return
    }
    setLoading(true)
    try {
      let me = await fetchMe()
      const pending = readPendingDisplayName()
      if (pending && !me.display_name?.trim()) {
        me = await updateMyProfile({ display_name: pending })
        clearPendingDisplayName()
      }
      setProfile(me)
    } catch {
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (authLoading) return
    void refreshProfile()
  }, [authLoading, isAuthenticated, refreshProfile])

  const saveDisplayName = useCallback(
    async (name: string) => {
      const me = await updateMyProfile({ display_name: name })
      clearPendingDisplayName()
      setProfile(me)
    },
    [],
  )

  const value = useMemo(
    (): UserProfileContextValue => ({
      profile,
      loading,
      refreshProfile,
      saveDisplayName,
    }),
    [profile, loading, refreshProfile, saveDisplayName],
  )

  return <UserProfileContext.Provider value={value}>{children}</UserProfileContext.Provider>
}

export function useUserProfile(): UserProfileContextValue {
  const ctx = useContext(UserProfileContext)
  if (!ctx) throw new Error('useUserProfile must be used within UserProfileProvider')
  return ctx
}
