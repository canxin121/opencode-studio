import { createApp } from 'vue'
import { createPinia } from 'pinia'

import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'

import 'katex/dist/katex.min.css'

import './style.css'
import App from './App.vue'
import { router } from './router'
import { readSessionIdFromQuery } from './app/navigation/sessionQuery'
import { useToastsStore } from './stores/toasts'
import { useAuthStore } from './stores/auth'
import {
  OC_AUTH_REQUIRED_EVENT,
  readAuthRequiredFromStorage,
  clearAuthRequiredFromStorage,
  type AuthRequiredDetail,
} from './lib/authEvents.ts'

// Capture initial page-load context so components that mount lazily (e.g. mobile sidebar)
// can still tell whether a session query came from a fresh load vs in-app navigation.
const PAGE_LOAD_TOKEN_KEY = 'oc2.pageLoadToken'
const INITIAL_SESSION_QUERY_KEY = 'oc2.initialSessionQuery'
try {
  const token = String(performance.timeOrigin || Date.now())
  sessionStorage.setItem(PAGE_LOAD_TOKEN_KEY, token)
  const params = new URLSearchParams(window.location.search || '')
  const sid = readSessionIdFromQuery({
    sessionid: params.get('sessionid'),
    sessionId: params.get('sessionId'),
    session: params.get('session'),
  })
  sessionStorage.setItem(INITIAL_SESSION_QUERY_KEY, sid)
} catch {
  // ignore
}

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
const toasts = useToastsStore(pinia)
const auth = useAuthStore(pinia)

// Global auth-required handler: toast then show login screen.
let lastAuthToastAt = 0
let lastAuthToastMsg = ''
let authRefreshInFlight: Promise<void> | null = null

function ensureAuthRefreshSoon() {
  if (authRefreshInFlight) return
  authRefreshInFlight = auth
    .refresh()
    .catch(() => {})
    .finally(() => {
      authRefreshInFlight = null
    })
}

function handleAuthRequired(detail?: AuthRequiredDetail) {
  const msg = String(detail?.message || 'UI authentication required').trim() || 'UI authentication required'

  const now = Date.now()
  if (msg !== lastAuthToastMsg || now - lastAuthToastAt > 4000) {
    lastAuthToastMsg = msg
    lastAuthToastAt = now
    toasts.push('error', msg, 4500)
  }

  // Switch to the login screen immediately, then reconcile state from /auth/session.
  try {
    auth.requireLogin()
  } catch {
    // ignore
  }
  ensureAuthRefreshSoon()
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener(OC_AUTH_REQUIRED_EVENT, (evt) => {
    const detail = (evt as unknown as { detail?: AuthRequiredDetail }).detail
    handleAuthRequired(detail)
  })
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener(OC_AUTH_REQUIRED_EVENT, (evt) => {
    const detail = (evt as unknown as { detail?: AuthRequiredDetail }).detail
    handleAuthRequired(detail)
  })
}

// Best-effort replay for early or non-CustomEvent environments.
const stored = readAuthRequiredFromStorage()
clearAuthRequiredFromStorage()
if (stored && stored.at > 0 && Date.now() - stored.at < 30_000) {
  handleAuthRequired(stored.detail)
}

app.mount('#app')
