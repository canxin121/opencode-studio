import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { registerSW } from 'virtual:pwa-register'

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
app.mount('#app')

// PWA: keep SW updated in the background.
const toasts = useToastsStore(pinia)
let updateToastShown = false
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    if (updateToastShown) return
    updateToastShown = true
    toasts.push('info', 'Update available.', 0, {
      label: 'Reload',
      onClick: () => void updateSW(true),
    })
  },
  onOfflineReady() {
    toasts.push('success', 'App ready for offline use', 3500)
  },
})
