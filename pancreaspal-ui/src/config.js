// API Configuration
export const API_CONFIG = {
  BASE_URL: process.env.VITE_API_URL || 'http://localhost:8000',
  TIMEOUT: 30000,
  ENDPOINTS: {
    QUERY: '/api/v1/patients/{patient_id}/query',
    APPEND_HISTORY: '/api/v1/patients/{patient_id}/append',
    GET_HISTORY: '/api/v1/patients/{patient_id}/history',
    AUTH_LOGIN: '/auth/login',
    AUTH_SIGNUP: '/auth/signup',
    AUTH_LOGOUT: '/auth/logout'
  }
};

// Message types for consistent handling
export const MESSAGE_TYPES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system'
};

// Local storage keys
export const STORAGE_KEYS = {
  TOKEN: 'pancreaspal_token',
  USER: 'pancreaspal_user',
  PATIENT_ID: 'currentPatientId',
  CONVERSATIONS: 'pancreaspal_conversations'
};

// UI Constants
export const UI_CONFIG = {
  COLORS: {
    MEDICAL_BLUE: '#1e54b7',
    MEDICAL_ORANGE: '#ff6f00',
    SUCCESS: '#4caf50',
    ERROR: '#f44336'
  },
  MESSAGES: {
    LOADING: 'Processing your request...',
    ERROR_GENERIC: 'An error occurred. Please try again.'
  }
};
