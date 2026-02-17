import { createRouter, createWebHistory, type RouteLocationNormalizedLoaded, type RouteRecordRaw } from 'vue-router'

const CHUNK_RECOVERY_KEY = 'oc2.chunkRecoveryReloaded'

function errMsg<T>(err: T): string {
  if (err instanceof Error) return err.message || String(err)
  return String(err)
}

function isProbablyLazyChunkError<T>(err: T): boolean {
  const msg = errMsg(err)
  // Browser/Vite (prod)
  if (msg.includes('Failed to fetch dynamically imported module')) return true
  if (msg.includes('Importing a module script failed')) return true
  // Webpack-style chunk loader (just in case)
  if (msg.includes('Loading chunk')) return true
  if (msg.includes('ChunkLoadError')) return true
  return false
}

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: (to) => ({ path: '/chat', query: to.query }),
  },
  {
    path: '/chat',
    component: () => import('./pages/ChatPage.vue'),
    meta: { shellSidebar: 'chat', mobilePanel: 'sessions' },
  },
  {
    path: '/terminal',
    component: () => import('./pages/TerminalPage.vue'),
    meta: { shellSidebar: 'none', mobilePanel: 'terminal' },
  },
  {
    path: '/files',
    component: () => import('./pages/FilesPage.vue'),
    meta: { shellSidebar: 'none', mobilePanel: 'files' },
  },
  {
    path: '/git',
    component: () => import('./pages/GitPage.vue'),
    meta: { shellSidebar: 'none', mobilePanel: 'git' },
  },
  { path: '/settings', redirect: '/settings/opencode/general' },
  {
    path: '/settings/plan/:section?',
    redirect: (to) => {
      const section = typeof to.params.section === 'string' ? to.params.section : ''
      return {
        path: section ? `/settings/plugins/${section}` : '/settings/plugins',
        query: to.query,
        hash: to.hash,
      }
    },
  },
  {
    path: '/settings/:tab/:section?',
    component: () => import('./pages/SettingsPage.vue'),
    meta: { shellSidebar: 'none', mobilePanel: 'settings' },
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

// In production, a service-worker update / CDN cache / rolling deploy can briefly
// leave the app with an in-memory bundle that references a chunk that no longer
// exists on the server. Vue Router surfaces that as a lazy-load error.
//
// Recovery strategy: hard reload once per tab session to pick up a consistent
// asset graph.
router.onError((err, to?: RouteLocationNormalizedLoaded) => {
  if (!isProbablyLazyChunkError(err)) return

  let alreadyReloaded = false
  try {
    alreadyReloaded = sessionStorage.getItem(CHUNK_RECOVERY_KEY) === '1'
    if (!alreadyReloaded) sessionStorage.setItem(CHUNK_RECOVERY_KEY, '1')
  } catch {
    // ignore storage failures
  }

  try {
    console.warn('[router] lazy chunk load failed; reloading once', {
      to: to?.fullPath,
      message: errMsg(err),
    })
  } catch {
    // ignore
  }

  if (alreadyReloaded) return

  // Prefer the failed navigation target if available.
  const target = typeof to?.fullPath === 'string' && to.fullPath ? to.fullPath : window.location.href
  window.location.assign(target)
})
