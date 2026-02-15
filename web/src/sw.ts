/// <reference lib="webworker" />

// NOTE: keep the Workbox injection point so vite-plugin-pwa can build.
// We intentionally keep this SW minimal: iOS Safari can be fragile with more
// complex SW bundles.

import { createHandlerBoundToURL, precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision?: string }>
}

// This is the Workbox injection point.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// SPA navigation fallback.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

// Update flow: don't take over running pages automatically.
// The app will explicitly trigger activation via `SKIP_WAITING` (prompted to the user).
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = (event as { data?: { type?: string } | null }).data
  if (data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting())
  }
})

// Push notifications intentionally disabled.
