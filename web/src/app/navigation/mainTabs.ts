export type MainTabId = 'chat' | 'files' | 'terminal' | 'git'

export type MainTabDef = {
  id: MainTabId
  path: string
  labelKey: string
}

export const MAIN_TABS: MainTabDef[] = [
  { id: 'chat', path: '/chat', labelKey: 'nav.chat' },
  { id: 'files', path: '/files', labelKey: 'nav.files' },
  { id: 'terminal', path: '/terminal', labelKey: 'nav.terminal' },
  { id: 'git', path: '/git', labelKey: 'nav.git' },
]

const MAIN_TAB_IDS = new Set<MainTabId>(MAIN_TABS.map((tab) => tab.id))

export function isMainTabId(value: string): value is MainTabId {
  return MAIN_TAB_IDS.has(value as MainTabId)
}

export function mainTabFromPath(path: string): MainTabId {
  const p = String(path || '').toLowerCase()
  for (const tab of MAIN_TABS) {
    if (p.startsWith(tab.path)) return tab.id
  }
  return 'chat'
}
