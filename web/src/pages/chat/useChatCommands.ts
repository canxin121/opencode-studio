import { computed, nextTick, ref, watch, type Ref } from 'vue'

import {
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiBookOpenLine,
  RiClipboardLine,
  RiCommandLine,
  RiDashboardLine,
  RiEditLine,
  RiFileLine,
  RiFileUploadLine,
  RiFlashlightLine,
  RiLinkM,
  RiPaletteLine,
  RiPlugLine,
  RiShieldKeyholeLine,
  RiShareLine,
  RiScissorsLine,
  RiStackLine,
  RiTerminalBoxLine,
  RiTimeLine,
  RiUserLine,
} from '@remixicon/vue'

import { apiJson } from '@/lib/api'

export type Command = {
  name: string
  description?: string
  agent?: string | null
  model?: string | null
  scope?: string
  isBuiltIn?: boolean
  aliases?: string[]
}

type ComposerExpose = {
  textareaEl?: HTMLTextAreaElement | { value: HTMLTextAreaElement | null } | null
}

function getComposerTextareaEl(composer: ComposerExpose | null): HTMLTextAreaElement | null {
  const textarea = composer?.textareaEl
  if (!textarea) return null
  return textarea instanceof HTMLTextAreaElement ? textarea : textarea.value
}

export function useChatCommands(opts: {
  sessionDirectory: Ref<string>
  draft: Ref<string>
  composerRef: Ref<ComposerExpose | null>

  // Close selection pickers when typing.
  composerPickerOpen: Ref<null | 'agent' | 'model' | 'variant'>

  // Hooks into model selection.
  getSelectedAgent: () => string
  setAgentFromCommand: (agent: string) => void
  setModelSlugFromCommand: (slug: string) => void

  onSend: () => Promise<void>
}) {
  const {
    sessionDirectory,
    draft,
    composerRef,
    composerPickerOpen,
    getSelectedAgent,
    setAgentFromCommand,
    setModelSlugFromCommand,
    onSend,
  } = opts

  const commands = ref<Command[]>([])
  const commandsLoading = ref(false)
  const commandQuery = ref('')
  const commandOpen = ref(false)
  const commandIndex = ref(0)

  function closeCommandPalette() {
    commandOpen.value = false
    commandQuery.value = ''
    commandIndex.value = 0
  }

  function commandDirQuery(): string {
    const dir = sessionDirectory.value
    return dir ? `?directory=${encodeURIComponent(dir)}` : ''
  }

  async function loadCommands() {
    commandsLoading.value = true
    try {
      const list = await apiJson<Command[]>(`/api/command${commandDirQuery()}`)
      commands.value = Array.isArray(list) ? list : []
    } catch {
      commands.value = []
    } finally {
      commandsLoading.value = false
    }
  }

  const builtInCommands = computed<Command[]>(() => [
    { name: 'connect', description: 'Add a provider and connect API keys.', scope: 'system', isBuiltIn: true },
    {
      name: 'compact',
      description: 'Compact the current session (alias: /summarize).',
      scope: 'session',
      isBuiltIn: true,
      aliases: ['summarize'],
    },
    { name: 'details', description: 'Toggle tool execution details.', scope: 'session', isBuiltIn: true },
    { name: 'editor', description: 'Open external editor for composing messages.', scope: 'session', isBuiltIn: true },
    {
      name: 'exit',
      description: 'Exit OpenCode (aliases: /quit, /q).',
      scope: 'system',
      isBuiltIn: true,
      aliases: ['quit', 'q'],
    },
    { name: 'export', description: 'Export the current session transcript.', scope: 'session', isBuiltIn: true },
    { name: 'help', description: 'Show the help dialog.', scope: 'system', isBuiltIn: true },
    { name: 'init', description: 'Create or update AGENTS.md file.', scope: 'system', isBuiltIn: true },
    { name: 'models', description: 'List or switch available models.', scope: 'agent', isBuiltIn: true },
    {
      name: 'new',
      description: 'Start a new session (alias: /clear).',
      scope: 'session',
      isBuiltIn: true,
      aliases: ['clear'],
    },
    { name: 'redo', description: 'Redo a previously undone message.', scope: 'session', isBuiltIn: true },
    {
      name: 'sessions',
      description: 'List and switch sessions (aliases: /resume, /continue).',
      scope: 'session',
      isBuiltIn: true,
      aliases: ['resume', 'continue'],
    },
    { name: 'share', description: 'Share current session.', scope: 'session', isBuiltIn: true },
    { name: 'unshare', description: 'Unshare current session.', scope: 'session', isBuiltIn: true },
    { name: 'themes', description: 'List available themes.', scope: 'system', isBuiltIn: true, aliases: ['theme'] },
    {
      name: 'thinking',
      description: 'Toggle thinking blocks (alias: /toggle-thinking).',
      scope: 'session',
      isBuiltIn: true,
      aliases: ['toggle-thinking'],
    },
    { name: 'undo', description: 'Undo last message.', scope: 'session', isBuiltIn: true },
    {
      name: 'timestamps',
      description: 'Toggle message timestamps (alias: /toggle-timestamps).',
      scope: 'session',
      isBuiltIn: true,
      aliases: ['toggle-timestamps'],
    },
    { name: 'status', description: 'Show OpenCode status.', scope: 'system', isBuiltIn: true },
    { name: 'agents', description: 'List available agents.', scope: 'agent', isBuiltIn: true },
    { name: 'mcps', description: 'Toggle MCP connections.', scope: 'agent', isBuiltIn: true },
    { name: 'rename', description: 'Rename current session.', scope: 'session', isBuiltIn: true },
    { name: 'timeline', description: 'Jump to a specific message.', scope: 'session', isBuiltIn: true },
    { name: 'fork', description: 'Fork from a message.', scope: 'session', isBuiltIn: true },
    { name: 'copy', description: 'Copy session transcript to clipboard.', scope: 'session', isBuiltIn: true },
    { name: 'review', description: 'Review changes (commit/branch/pr).', scope: 'session', isBuiltIn: true },
  ])

  const mergedCommands = computed<Command[]>(() => {
    const map = new Map<string, Command>()
    for (const cmd of commands.value) {
      map.set(cmd.name, cmd)
    }
    for (const cmd of builtInCommands.value) {
      if (!map.has(cmd.name)) map.set(cmd.name, cmd)
    }
    return Array.from(map.values())
  })

  function commandScore(query: string, candidate: string): number | null {
    const q = query.trim().toLowerCase()
    if (!q) return 0
    const c = candidate.toLowerCase()
    let score = 0
    let lastIndex = -1
    let consecutive = 0

    for (let i = 0; i < q.length; i += 1) {
      const ch = q[i]
      if (!ch || ch === ' ') continue
      const idx = c.indexOf(ch, lastIndex + 1)
      if (idx === -1) return null

      const gap = idx - lastIndex - 1
      if (gap === 0) consecutive += 1
      else consecutive = 0

      score += 10
      score += Math.max(0, 18 - idx)
      score -= Math.max(0, gap)
      if (idx === 0) score += 12
      else {
        const prev = c[idx - 1]
        if (prev === '/' || prev === '_' || prev === '-' || prev === '.' || prev === ' ') {
          score += 10
        }
      }
      score += consecutive > 0 ? 12 : 0
      lastIndex = idx
    }

    score += Math.max(0, 24 - Math.round(c.length / 3))
    return score
  }

  const filteredCommands = computed<Command[]>(() => {
    const q = commandQuery.value.trim().toLowerCase()
    const list = mergedCommands.value
    if (!q) return list
    const ranked = list
      .map((cmd) => {
        const aliasBlob = cmd.aliases?.join(' ') || ''
        const score =
          commandScore(q, cmd.name) ||
          commandScore(q, cmd.description || '') ||
          (aliasBlob ? commandScore(q, aliasBlob) : null)
        return score === null ? null : { cmd, score }
      })
      .filter(Boolean) as Array<{ cmd: Command; score: number }>
    ranked.sort((a, b) => b.score - a.score || a.cmd.name.localeCompare(b.cmd.name))
    return ranked.map((entry) => entry.cmd)
  })

  watch(
    () => filteredCommands.value.length,
    () => {
      commandIndex.value = 0
    },
  )

  watch(
    () => commandQuery.value,
    () => {
      commandIndex.value = 0
    },
  )

  function dismissCommandPaletteOnInput() {
    // Typing in the textarea should dismiss model/agent/variant pickers.
    if (composerPickerOpen.value) {
      composerPickerOpen.value = null
    }

    closeCommandPalette()
  }

  function handleDraftInput() {
    if (!getComposerTextareaEl(composerRef.value)) return
    dismissCommandPaletteOnInput()
  }

  function handleDraftKeydown(e: KeyboardEvent) {
    // Enter inserts a newline; Cmd/Ctrl+Enter sends.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void onSend()
    }
  }

  function insertCommand(command: Command) {
    draft.value = `/${command.name} `
    closeCommandPalette()

    if (command.agent && !getSelectedAgent().trim()) {
      setAgentFromCommand(command.agent)
    }
    if (command.model) {
      const raw = command.model.trim()
      if (raw.includes('/')) {
        setModelSlugFromCommand(raw)
      }
    }

    void nextTick(() => {
      const input = getComposerTextareaEl(composerRef.value)
      if (!input) return
      input.focus()
      const len = input.value.length
      input.setSelectionRange(len, len)
    })
  }

  function commandIcon(cmd: Command) {
    switch (cmd.name) {
      case 'init':
        return RiFileLine
      case 'editor':
        return RiEditLine
      case 'export':
        return RiFileUploadLine
      case 'copy':
        return RiClipboardLine
      case 'undo':
        return RiArrowGoBackLine
      case 'redo':
        return RiArrowGoForwardLine
      case 'timeline':
        return RiTimeLine
      case 'compact':
        return RiScissorsLine
      case 'themes':
        return RiPaletteLine
      case 'models':
        return RiStackLine
      case 'agents':
        return RiUserLine
      case 'mcps':
        return RiShieldKeyholeLine
      case 'connect':
        return RiPlugLine
      case 'status':
        return RiDashboardLine
      case 'help':
        return RiBookOpenLine
      case 'share':
        return RiShareLine
      case 'unshare':
        return RiLinkM
      case 'test':
      case 'build':
      case 'run':
        return RiTerminalBoxLine
      default:
        return cmd.isBuiltIn ? RiFlashlightLine : RiCommandLine
    }
  }

  return {
    commands,
    commandsLoading,
    commandQuery,
    commandOpen,
    commandIndex,
    filteredCommands,
    loadCommands,
    handleDraftInput,
    handleDraftKeydown,
    insertCommand,
    commandIcon,
  }
}
