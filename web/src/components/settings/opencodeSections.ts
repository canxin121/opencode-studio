export type OpencodeSection = {
  id: string
  labelKey: string
}

export const opencodeSections: OpencodeSection[] = [
  { id: 'general', labelKey: 'settings.opencodeConfig.navigation.sections.general' },
  { id: 'instructions', labelKey: 'settings.opencodeConfig.navigation.sections.instructions' },
  { id: 'providers', labelKey: 'settings.opencodeConfig.navigation.sections.providers' },
  { id: 'tui', labelKey: 'settings.opencodeConfig.navigation.sections.tui' },
  { id: 'server', labelKey: 'settings.opencodeConfig.navigation.sections.server' },
  { id: 'commands', labelKey: 'settings.opencodeConfig.navigation.sections.commands' },
  { id: 'agents', labelKey: 'settings.opencodeConfig.navigation.sections.agents' },
  { id: 'permissions', labelKey: 'settings.opencodeConfig.navigation.sections.permissions' },
  { id: 'mcp', labelKey: 'settings.opencodeConfig.navigation.sections.mcp' },
  { id: 'formatter', labelKey: 'settings.opencodeConfig.navigation.sections.formatter' },
  { id: 'keybinds', labelKey: 'settings.opencodeConfig.navigation.sections.keybinds' },
  { id: 'compaction', labelKey: 'settings.opencodeConfig.navigation.sections.compaction' },
  { id: 'experimental', labelKey: 'settings.opencodeConfig.navigation.sections.experimental' },
  { id: 'enterprise', labelKey: 'settings.opencodeConfig.navigation.sections.enterprise' },
]
