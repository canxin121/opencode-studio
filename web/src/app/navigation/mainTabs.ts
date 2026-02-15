export type MainTabId = 'chat' | 'files' | 'terminal' | 'git'

export type MainTabDef = {
  id: MainTabId
  path: string
  label: string
}

export const MAIN_TABS: MainTabDef[] = [
  { id: 'chat', path: '/chat', label: 'Chat' },
  { id: 'files', path: '/files', label: 'Files' },
  { id: 'terminal', path: '/terminal', label: 'Terminal' },
  { id: 'git', path: '/git', label: 'Git' },
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
