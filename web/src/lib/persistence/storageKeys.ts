const STORAGE_NAMESPACE = 'studio'

function namespacedKey(path: string): string {
  return `${STORAGE_NAMESPACE}.${path}`
}

export const localStorageKeys = {
  ui: {
    sidebarOpen: namespacedKey('ui.sidebar.open'),
    sidebarWidth: namespacedKey('ui.sidebar.width'),
    activeMainTab: namespacedKey('ui.active-main-tab'),
    locale: namespacedKey('ui.locale'),
  },
  directory: {
    lastDirectory: namespacedKey('directory.last-directory'),
  },
  chat: {
    lastSessionId: namespacedKey('chat.last-session-id'),
    sessionRunConfig: namespacedKey('chat.session-run-config'),
    composerUserHeight: namespacedKey('chat.composer.user-height'),
    modelVariantByKey: namespacedKey('chat.model.variant-by-key'),
    sessionManualModelBySession: namespacedKey('chat.model.manual-by-session'),
    sidebarUiPrefs: namespacedKey('chat.sidebar-ui-prefs.v1'),
  },
  git: {
    selectedRepoByProject: namespacedKey('git.selected-repo-by-project'),
    closedReposByProject: namespacedKey('git.closed-repos-by-project'),
    gitmoji: namespacedKey('git.gitmoji'),
  },
  terminal: {
    gitHandoffSessionId: namespacedKey('terminal.git-handoff-session-id'),
  },
  files: {
    showHidden: namespacedKey('files.show-hidden'),
    respectGitignore: namespacedKey('files.respect-gitignore'),
    autosave: namespacedKey('files.autosave'),
    sidebarMode: namespacedKey('files.sidebar-mode'),
    searchMode: namespacedKey('files.search-mode'),
    contentScopeMode: namespacedKey('files.content-scope-mode'),
    explorerUiPrefix: namespacedKey('files.explorer.ui:'),
    explorerCachePrefix: namespacedKey('files.explorer.cache:'),
  },
  settings: {
    lastRoute: namespacedKey('settings.last-route'),
    opencodeWarnJsoncRewrite: namespacedKey('settings.opencode.warn-jsonc-rewrite'),
    opencodeSaveMeta: namespacedKey('settings.opencode.save-meta.v2'),
  },
  auth: {
    uiTokenByBaseUrl: namespacedKey('auth.ui-token-by-base-url.v1'),
  },
  backends: {
    configV1: namespacedKey('backends.v1'),
  },
  broadcast: {
    channelFallbackEvent: namespacedKey('broadcast.event'),
  },
} as const

export const sessionStorageKeys = {
  app: {
    pageLoadToken: namespacedKey('app.page-load-token'),
    initialSessionQuery: namespacedKey('app.initial-session-query'),
    chunkRecoveryReloaded: namespacedKey('app.chunk-recovery-reloaded'),
  },
  auth: {
    authRequired: namespacedKey('auth.required'),
  },
  broadcast: {
    senderId: namespacedKey('broadcast.sender-id'),
  },
  terminal: {
    handoffKeyPrefix: namespacedKey('terminal.handoff:'),
    gitHandoffSessionId: namespacedKey('terminal.git-handoff-session-id'),
  },
  sessions: {
    bootCollapseAppliedToken: namespacedKey('sessions.boot-collapse.applied-token'),
    autoLoadExpandedAppliedToken: namespacedKey('sessions.auto-load-expanded.applied-token'),
  },
} as const

export const indexedDbNames = {
  directorySessionSnapshot: namespacedKey('directory-session-snapshot'),
} as const

export function gitRepoScopedStorageKey(scope: string, repoRoot: string | null | undefined): string {
  const suffix = String(scope || '').trim()
  const root = String(repoRoot || '').trim()
  return `${namespacedKey(`git.repo.${suffix}`)}:${root || 'none'}`
}
