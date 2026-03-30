export const SETTINGS_TAB_IDS = ['opencode', 'plugins', 'backends', 'appearance', 'debug'] as const

export type SettingsTab = (typeof SETTINGS_TAB_IDS)[number]
export type SettingsSidebarGroupId = 'primary' | 'secondary'
export type SettingsSidebarIconKey = 'opencode' | 'plugins' | 'backends' | 'appearance' | 'debug'

export type SettingsSidebarTab = {
  id: SettingsTab
  label: string
  icon: SettingsSidebarIconKey
  group: SettingsSidebarGroupId
  keywords?: string[]
}

export type SettingsSidebarLeafItem = {
  id: string
  label: string
  keywords?: string[]
}

export type SettingsSidebarChildRow = {
  kind: 'opencode-section' | 'plugin-section'
  id: string
  label: string
  parentId: 'opencode' | 'plugins'
  active: boolean
}

export type SettingsSidebarTabRow = {
  kind: 'tab'
  id: SettingsTab
  label: string
  icon: SettingsSidebarIconKey
  active: boolean
  expandable: boolean
  expanded: boolean
  childCount: number
  childMatchCount: number
  children: SettingsSidebarChildRow[]
}

export type SettingsSidebarRenderGroup = {
  id: SettingsSidebarGroupId
  items: SettingsSidebarTabRow[]
}

const SETTINGS_TAB_CONFIG: Array<{
  id: SettingsTab
  labelKey: string
  icon: SettingsSidebarIconKey
  group: SettingsSidebarGroupId
  keywords?: string[]
}> = [
  {
    id: 'opencode',
    labelKey: 'settings.tabs.opencode',
    icon: 'opencode',
    group: 'primary',
    keywords: ['config', 'configuration', 'agent', 'model', 'provider'],
  },
  {
    id: 'plugins',
    labelKey: 'settings.tabs.plugins',
    icon: 'plugins',
    group: 'primary',
    keywords: ['extensions', 'integrations', 'marketplace'],
  },
  {
    id: 'backends',
    labelKey: 'settings.tabs.backends',
    icon: 'backends',
    group: 'secondary',
    keywords: ['service', 'server', 'runtime', 'updates'],
  },
  {
    id: 'appearance',
    labelKey: 'settings.tabs.appearance',
    icon: 'appearance',
    group: 'secondary',
    keywords: ['theme', 'fonts', 'ui'],
  },
  {
    id: 'debug',
    labelKey: 'settings.tabs.debug',
    icon: 'debug',
    group: 'secondary',
    keywords: ['logging', 'diagnostics', 'developer'],
  },
]

export function isSettingsTab(input: string): input is SettingsTab {
  return SETTINGS_TAB_IDS.includes(input as SettingsTab)
}

export function buildSettingsSidebarTabs(
  resolveLabel: (id: SettingsTab, labelKey: string) => string,
): SettingsSidebarTab[] {
  return SETTINGS_TAB_CONFIG.map((item) => ({
    id: item.id,
    label: resolveLabel(item.id, item.labelKey),
    icon: item.icon,
    group: item.group,
    keywords: item.keywords,
  }))
}

export function normalizeSettingsSidebarQuery(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
}

function matchesSidebarQuery(query: string, parts: Array<string | undefined>): boolean {
  if (!query) return true
  return parts.some((part) => normalizeSettingsSidebarQuery(part || '').includes(query))
}

function buildChildRows(
  parentId: 'opencode' | 'plugins',
  items: SettingsSidebarLeafItem[],
  activeId: string | null,
): SettingsSidebarChildRow[] {
  return items.map((item) => ({
    kind: parentId === 'opencode' ? 'opencode-section' : 'plugin-section',
    id: item.id,
    label: item.label,
    parentId,
    active: activeId === item.id,
  }))
}

export function buildSettingsSidebarGroups(args: {
  query: string
  tabs: SettingsSidebarTab[]
  activeTab: SettingsTab
  activeOpencodeSection: string | null
  activePluginsSection: string | null
  opencodeSections: SettingsSidebarLeafItem[]
  plugins: SettingsSidebarLeafItem[]
}): SettingsSidebarRenderGroup[] {
  const query = normalizeSettingsSidebarQuery(args.query)

  const groups = new Map<SettingsSidebarGroupId, SettingsSidebarTabRow[]>([
    ['primary', []],
    ['secondary', []],
  ])

  for (const tab of args.tabs) {
    const childSource =
      tab.id === 'opencode'
        ? buildChildRows('opencode', args.opencodeSections, args.activeOpencodeSection)
        : tab.id === 'plugins'
          ? buildChildRows('plugins', args.plugins, args.activePluginsSection)
          : []

    const matchingChildren = childSource.filter((child) => matchesSidebarQuery(query, [child.label, child.id]))

    const selfMatches = matchesSidebarQuery(query, [tab.label, tab.id, ...(tab.keywords || [])])
    const visible = !query || selfMatches || matchingChildren.length > 0
    if (!visible) continue

    const expanded = childSource.length > 0 && (!query ? args.activeTab === tab.id : matchingChildren.length > 0)
    const visibleChildren = expanded ? (!query ? childSource : matchingChildren) : []

    groups.get(tab.group)?.push({
      kind: 'tab',
      id: tab.id,
      label: tab.label,
      icon: tab.icon,
      active: args.activeTab === tab.id,
      expandable: childSource.length > 0,
      expanded,
      childCount: childSource.length,
      childMatchCount: matchingChildren.length,
      children: visibleChildren,
    })
  }

  return Array.from(groups.entries())
    .map(([id, items]) => ({ id, items }))
    .filter((group) => group.items.length > 0)
}
