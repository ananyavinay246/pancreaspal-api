import { Amplify } from 'aws-amplify'

const userPoolId = (import.meta.env.VITE_COGNITO_USER_POOL_ID ?? '').trim()
const userPoolClientId = (import.meta.env.VITE_COGNITO_CLIENT_ID ?? '').trim()
const region = (import.meta.env.VITE_COGNITO_REGION ?? 'us-east-1').trim()

let configured = false

export function isAuthConfigured(): boolean {
  return userPoolId.length > 0 && userPoolClientId.length > 0
}

export function configureAmplifyAuth(): void {
  if (!isAuthConfigured() || configured) return
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        loginWith: { email: true },
      },
    },
  })
  configured = true
}

export function getCognitoRegion(): string {
  return region
}
