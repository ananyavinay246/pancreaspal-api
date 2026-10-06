/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_DEMO_PATIENT_ID?: string
  readonly VITE_SHOW_DEMO_BANNER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
