import { getSessionString, setSessionString } from '@/lib/persist'

// Page-load tokens let the mobile sidebar mount/unmount without re-applying expensive defaults.
const PAGE_LOAD_TOKEN_KEY = 'oc2.pageLoadToken'

// Mobile sidebar can mount/unmount; avoid re-applying "boot collapse all" on every mount.
const BOOT_COLLAPSE_APPLIED_TOKEN_KEY = 'oc2.sessions.bootCollapse.appliedToken'

const AUTOLOAD_EXPANDED_APPLIED_TOKEN_KEY = 'oc2.sessions.autoLoadExpanded.appliedToken'

function getPageLoadToken(): string {
  const stored = getSessionString(PAGE_LOAD_TOKEN_KEY)
  if (stored) return stored

  let token = ''
  try {
    const timeOrigin = typeof performance !== 'undefined' ? performance.timeOrigin : 0
    token = String(timeOrigin || Date.now())
  } catch {
    token = String(Date.now())
  }
  setSessionString(PAGE_LOAD_TOKEN_KEY, token)
  return token
}

export function bootCollapseAlreadyAppliedThisLoad(): boolean {
  const token = getPageLoadToken()
  return getSessionString(BOOT_COLLAPSE_APPLIED_TOKEN_KEY) === token
}

export function markBootCollapseAppliedThisLoad() {
  const token = getPageLoadToken()
  setSessionString(BOOT_COLLAPSE_APPLIED_TOKEN_KEY, token)
}

export function autoLoadExpandedAlreadyAppliedThisLoad(): boolean {
  const token = getPageLoadToken()
  return getSessionString(AUTOLOAD_EXPANDED_APPLIED_TOKEN_KEY) === token
}

export function markAutoLoadExpandedAppliedThisLoad() {
  const token = getPageLoadToken()
  setSessionString(AUTOLOAD_EXPANDED_APPLIED_TOKEN_KEY, token)
}
