import { computed, ref, type Ref } from 'vue'

type ConfigValue = unknown
type UnknownRecord = Record<string, ConfigValue>

type GetPath = (obj: ConfigValue, path: string) => ConfigValue
type SetPath = (obj: ConfigValue, path: string, value: ConfigValue) => void
type DeletePath = (obj: ConfigValue, path: string) => void
type IsPlainObject = (v: ConfigValue) => v is UnknownRecord

export function useOpenCodeConfigPanelFields(opts: {
  draft: Ref<ConfigValue>
  getPath: GetPath
  setPath: SetPath
  deletePath: DeletePath
  setOrClear: (path: string, value: ConfigValue) => void
  normalizeStringList: (value: ConfigValue) => string[]
  setStringList: (path: string, list: string[]) => void
  isPlainObject: IsPlainObject
  ensureMap: (path: string) => UnknownRecord
  markDirty: () => void
}) {
  const {
    draft,
    getPath,
    setPath,
    deletePath,
    setOrClear,
    normalizeStringList,
    setStringList,
    isPlainObject,
    ensureMap,
    markDirty,
  } = opts

  function makeStringField(path: string) {
    return computed<string>({
      get: () => {
        const v = getPath(draft.value, path)
        return typeof v === 'string' ? v : ''
      },
      set: (v: string) => setOrClear(path, v),
    })
  }

  function makeNumberField(path: string) {
    return computed<string>({
      get: () => {
        const v = getPath(draft.value, path)
        return typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
      },
      set: (v: string) => {
        const raw = String(v ?? '').trim()
        if (!raw) {
          deletePath(draft.value, path)
          markDirty()
          return
        }
        const num = Number(raw)
        if (Number.isNaN(num)) {
          return
        }
        setPath(draft.value, path, num)
        markDirty()
      },
    })
  }

  function makeListField(path: string) {
    return computed<string>({
      get: () => {
        const v = getPath(draft.value, path)
        return Array.isArray(v) ? v.join('\n') : ''
      },
      set: (v: string) => {
        const list = v
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
        setOrClear(path, list)
      },
    })
  }

  function makeTriBool(path: string) {
    return computed<string>({
      get: () => {
        const v = getPath(draft.value, path)
        if (v === true) return 'true'
        if (v === false) return 'false'
        return 'default'
      },
      set: (v: string) => {
        if (v === 'default') {
          deletePath(draft.value, path)
        } else {
          setPath(draft.value, path, v === 'true')
        }
        markDirty()
      },
    })
  }

  function makeEnumField(path: string) {
    return computed<string>({
      get: () => {
        const v = getPath(draft.value, path)
        return typeof v === 'string' ? v : 'default'
      },
      set: (v: string) => {
        if (v === 'default') {
          deletePath(draft.value, path)
        } else {
          setPath(draft.value, path, v)
        }
        markDirty()
      },
    })
  }

  const schemaUrl = makeStringField('$schema')
  const theme = makeStringField('theme')
  const username = makeStringField('username')
  const defaultAgent = makeStringField('default_agent')
  const model = makeStringField('model')
  const smallModel = makeStringField('small_model')
  const logLevel = makeEnumField('logLevel')
  const shareMode = makeEnumField('share')

  const autoUpdateMode = computed<string>({
    get: () => {
      const v = getPath(draft.value, 'autoupdate')
      if (v === true) return 'true'
      if (v === false) return 'false'
      if (v === 'notify') return 'notify'
      return 'default'
    },
    set: (v: string) => {
      if (v === 'default') {
        deletePath(draft.value, 'autoupdate')
      } else if (v === 'notify') {
        setPath(draft.value, 'autoupdate', 'notify')
      } else {
        setPath(draft.value, 'autoupdate', v === 'true')
      }
      markDirty()
    },
  })

  const snapshotMode = makeTriBool('snapshot')
  const enabledProviders = makeListField('enabled_providers')
  const disabledProviders = makeListField('disabled_providers')

  const instructionsArr = computed<string[]>({
    get: () => normalizeStringList(getPath(draft.value, 'instructions')),
    set: (list) => setStringList('instructions', list),
  })
  const skillsPathsArr = computed<string[]>({
    get: () => normalizeStringList(getPath(draft.value, 'skills.paths')),
    set: (list) => setStringList('skills.paths', list),
  })
  const pluginsArr = computed<string[]>({
    get: () => normalizeStringList(getPath(draft.value, 'plugin')),
    set: (list) => setStringList('plugin', list),
  })

  const instructionsInput = ref('')
  const skillsPathsInput = ref('')
  const pluginsInput = ref('')

  const tuiScrollSpeed = makeNumberField('tui.scroll_speed')
  const tuiDiffStyle = makeEnumField('tui.diff_style')
  const tuiScrollAcceleration = computed<string>({
    get: () => {
      const v = getPath(draft.value, 'tui.scroll_acceleration.enabled')
      if (v === true) return 'true'
      if (v === false) return 'false'
      return 'default'
    },
    set: (v: string) => {
      if (v === 'default') {
        deletePath(draft.value, 'tui.scroll_acceleration')
      } else {
        const current = getPath(draft.value, 'tui.scroll_acceleration')
        const next = isPlainObject(current) ? { ...current, enabled: v === 'true' } : { enabled: v === 'true' }
        setPath(draft.value, 'tui.scroll_acceleration', next)
      }
      markDirty()
    },
  })

  const serverPort = makeNumberField('server.port')
  const serverHostname = makeStringField('server.hostname')
  const serverMdns = makeTriBool('server.mdns')
  const serverMdnsDomain = makeStringField('server.mdnsDomain')
  const serverCors = makeListField('server.cors')
  const watcherIgnore = makeListField('watcher.ignore')

  const serverCorsArr = computed<string[]>({
    get: () => normalizeStringList(getPath(draft.value, 'server.cors')),
    set: (list) => setStringList('server.cors', list),
  })
  const watcherIgnoreArr = computed<string[]>({
    get: () => normalizeStringList(getPath(draft.value, 'watcher.ignore')),
    set: (list) => setStringList('watcher.ignore', list),
  })

  const serverCorsInput = ref('')
  const watcherIgnoreInput = ref('')

  const compactionAuto = makeTriBool('compaction.auto')
  const compactionPrune = makeTriBool('compaction.prune')
  const enterpriseUrl = makeStringField('enterprise.url')

  const experimentalDisablePasteSummary = makeTriBool('experimental.disable_paste_summary')
  const experimentalBatchTool = makeTriBool('experimental.batch_tool')
  const experimentalOpenTelemetry = makeTriBool('experimental.openTelemetry')
  const experimentalPrimaryTools = makeListField('experimental.primary_tools')
  const experimentalContinueLoop = makeTriBool('experimental.continue_loop_on_deny')
  const experimentalMcpTimeout = makeNumberField('experimental.mcp_timeout')

  const formatterDisabled = computed<boolean>({
    get: () => getPath(draft.value, 'formatter') === false,
    set: (v: boolean) => {
      if (v) {
        setPath(draft.value, 'formatter', false)
      } else {
        deletePath(draft.value, 'formatter')
        ensureMap('formatter')
      }
      markDirty()
    },
  })

  const lspDisabled = computed<boolean>({
    get: () => getPath(draft.value, 'lsp') === false,
    set: (v: boolean) => {
      if (v) {
        setPath(draft.value, 'lsp', false)
      } else {
        deletePath(draft.value, 'lsp')
        ensureMap('lsp')
      }
      markDirty()
    },
  })

  return {
    schemaUrl,
    theme,
    username,
    defaultAgent,
    model,
    smallModel,
    logLevel,
    shareMode,
    autoUpdateMode,
    snapshotMode,
    enabledProviders,
    disabledProviders,
    instructionsArr,
    skillsPathsArr,
    pluginsArr,
    instructionsInput,
    skillsPathsInput,
    pluginsInput,
    tuiScrollSpeed,
    tuiDiffStyle,
    tuiScrollAcceleration,
    serverPort,
    serverHostname,
    serverMdns,
    serverMdnsDomain,
    serverCors,
    watcherIgnore,
    serverCorsArr,
    watcherIgnoreArr,
    serverCorsInput,
    watcherIgnoreInput,
    compactionAuto,
    compactionPrune,
    enterpriseUrl,
    experimentalDisablePasteSummary,
    experimentalBatchTool,
    experimentalOpenTelemetry,
    experimentalPrimaryTools,
    experimentalContinueLoop,
    experimentalMcpTimeout,
    formatterDisabled,
    lspDisabled,
  }
}
