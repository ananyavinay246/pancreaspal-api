import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  confirmResetPassword,
  confirmSignUp,
  fetchAuthSession,
  getCurrentUser,
  resetPassword,
  signIn,
  signOut,
  signUp,
  type SignUpOutput,
} from 'aws-amplify/auth'
import { configureAmplifyAuth, isAuthConfigured } from './authConfig'
import { clearPrivatePatientCache } from './patientSession'
import { setPatientSessionAuth } from './patientSessionAuth'

export type AuthView = 'signIn' | 'signUp' | 'confirmSignUp' | 'forgotPassword' | 'confirmReset'

type AuthContextValue = {
  authConfigured: boolean
  isAuthenticated: boolean
  email: string | null
  userInitial: string
  loading: boolean
  authModal: AuthView | null
  pendingSignUpEmail: string
  openAuth: (view?: AuthView) => void
  closeAuth: () => void
  signInWithPassword: (email: string, password: string) => Promise<void>
  signUpWithPassword: (email: string, password: string) => Promise<SignUpOutput>
  confirmSignUpCode: (code: string) => Promise<void>
  forgotPassword: (email: string) => Promise<void>
  confirmForgotPassword: (code: string, newPassword: string) => Promise<void>
  signOutUser: () => Promise<void>
  getIdToken: () => Promise<string | null>
  refreshAuth: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function initialFromEmail(email: string | null): string {
  if (!email) return '?'
  const ch = email.trim()[0]
  return ch ? ch.toUpperCase() : '?'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const authConfigured = isAuthConfigured()
  const [loading, setLoading] = useState(authConfigured)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [authModal, setAuthModal] = useState<AuthView | null>(null)
  const [pendingSignUpEmail, setPendingSignUpEmail] = useState('')

  const refreshAuth = useCallback(async () => {
    if (!authConfigured) {
      setIsAuthenticated(false)
      setEmail(null)
      setLoading(false)
      return
    }
    configureAmplifyAuth()
    try {
      await getCurrentUser()
      const session = await fetchAuthSession()
      const token = session.tokens?.idToken?.toString()
      if (!token) {
        setIsAuthenticated(false)
        setEmail(null)
        return
      }
      const payload = session.tokens?.idToken?.payload
      const claimEmail =
        typeof payload?.email === 'string'
          ? payload.email
          : typeof payload?.['cognito:username'] === 'string'
            ? payload['cognito:username']
            : null
      setEmail(claimEmail)
      setIsAuthenticated(true)
    } catch {
      setIsAuthenticated(false)
      setEmail(null)
    } finally {
      setLoading(false)
    }
  }, [authConfigured])

  useEffect(() => {
    void refreshAuth()
  }, [refreshAuth])

  const getIdToken = useCallback(async (): Promise<string | null> => {
    if (!authConfigured) return null
    try {
      const session = await fetchAuthSession()
      return session.tokens?.idToken?.toString() ?? null
    } catch {
      return null
    }
  }, [authConfigured])

  useEffect(() => {
    setPatientSessionAuth({
      isAuthenticated,
      getIdToken,
    })
  }, [isAuthenticated, getIdToken])

  const signInWithPassword = useCallback(async (rawEmail: string, password: string) => {
    configureAmplifyAuth()
    const emailNorm = rawEmail.trim().toLowerCase()
    const result = await signIn({ username: emailNorm, password })
    if (result.nextStep.signInStep !== 'DONE') {
      throw new Error('Additional sign-in steps are not supported in this app.')
    }
    clearPrivatePatientCache()
    await refreshAuth()
    setAuthModal(null)
  }, [refreshAuth])

  const signUpWithPassword = useCallback(async (rawEmail: string, password: string) => {
    configureAmplifyAuth()
    const emailNorm = rawEmail.trim().toLowerCase()
    const out = await signUp({
      username: emailNorm,
      password,
      options: { userAttributes: { email: emailNorm } },
    })
    setPendingSignUpEmail(emailNorm)
    setAuthModal('confirmSignUp')
    return out
  }, [])

  const confirmSignUpCode = useCallback(async (code: string) => {
    configureAmplifyAuth()
    if (!pendingSignUpEmail) throw new Error('No pending sign-up email.')
    await confirmSignUp({ username: pendingSignUpEmail, confirmationCode: code.trim() })
    setAuthModal('signIn')
  }, [pendingSignUpEmail])

  const forgotPassword = useCallback(async (rawEmail: string) => {
    configureAmplifyAuth()
    const emailNorm = rawEmail.trim().toLowerCase()
    setPendingSignUpEmail(emailNorm)
    await resetPassword({ username: emailNorm })
    setAuthModal('confirmReset')
  }, [])

  const confirmForgotPassword = useCallback(async (code: string, newPassword: string) => {
    configureAmplifyAuth()
    if (!pendingSignUpEmail) throw new Error('No email for password reset.')
    await confirmResetPassword({
      username: pendingSignUpEmail,
      confirmationCode: code.trim(),
      newPassword,
    })
    setAuthModal('signIn')
  }, [pendingSignUpEmail])

  const signOutUser = useCallback(async () => {
    if (authConfigured) {
      configureAmplifyAuth()
      try {
        await signOut()
      } catch {
        /* ignore */
      }
    }
    clearPrivatePatientCache()
    setIsAuthenticated(false)
    setEmail(null)
  }, [authConfigured])

  const value = useMemo(
    (): AuthContextValue => ({
      authConfigured,
      isAuthenticated,
      email,
      userInitial: initialFromEmail(email),
      loading,
      authModal,
      pendingSignUpEmail,
      openAuth: (view = 'signIn') => setAuthModal(view),
      closeAuth: () => setAuthModal(null),
      signInWithPassword,
      signUpWithPassword,
      confirmSignUpCode,
      forgotPassword,
      confirmForgotPassword,
      signOutUser,
      getIdToken,
      refreshAuth,
    }),
    [
      authConfigured,
      isAuthenticated,
      email,
      loading,
      authModal,
      pendingSignUpEmail,
      signInWithPassword,
      signUpWithPassword,
      confirmSignUpCode,
      forgotPassword,
      confirmForgotPassword,
      signOutUser,
      getIdToken,
      refreshAuth,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
