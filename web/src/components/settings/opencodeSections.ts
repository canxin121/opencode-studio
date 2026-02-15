export type OpencodeSection = {
  id: string
  label: string
}

export const opencodeSections: OpencodeSection[] = [
  { id: 'general', label: 'General' },
  { id: 'instructions', label: 'Instructions, Skills & Plugins' },
  { id: 'providers', label: 'Providers' },
  { id: 'tui', label: 'TUI' },
  { id: 'server', label: 'Server & Watcher' },
  { id: 'commands', label: 'Commands' },
  { id: 'agents', label: 'Agents' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'mcp', label: 'MCP' },
  { id: 'formatter', label: 'Formatter & LSP' },
  { id: 'keybinds', label: 'Keybinds' },
  { id: 'compaction', label: 'Compaction' },
  { id: 'experimental', label: 'Experimental' },
  { id: 'enterprise', label: 'Enterprise' },
]
