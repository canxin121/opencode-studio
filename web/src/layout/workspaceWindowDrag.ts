export const WORKSPACE_WINDOW_DRAG_MIME = 'application/x-opencode-workspace-window-id'
export const WORKSPACE_WINDOW_TEMPLATE_DRAG_MIME = 'application/x-opencode-workspace-window-template'
const WORKSPACE_WINDOW_TEMPLATE_TEXT_PREFIX = 'oc-workspace-window-template:'

export type WorkspaceWindowTemplateDragData = {
  tab: 'chat' | 'files' | 'preview' | 'terminal' | 'git' | 'settings'
  query?: Record<string, string>
  title?: string
  matchKeys?: string[]
  windowId?: string
}

function templatePayloadToText(payload: WorkspaceWindowTemplateDragData): string {
  return `${WORKSPACE_WINDOW_TEMPLATE_TEXT_PREFIX}${JSON.stringify(payload)}`
}

function parseTemplatePayloadFromText(raw: unknown): WorkspaceWindowTemplateDragData | null {
  const text = String(raw || '').trim()
  if (!text) return null

  if (text.startsWith(WORKSPACE_WINDOW_TEMPLATE_TEXT_PREFIX)) {
    const body = text.slice(WORKSPACE_WINDOW_TEMPLATE_TEXT_PREFIX.length)
    if (!body) return null
    try {
      const parsed = JSON.parse(body) as unknown
      return normalizeTemplatePayload(parsed)
    } catch {
      return null
    }
  }

  // Backward-compatible fallback for legacy plain-text format:
  //   <tab>:<json-query>
  // Example: files:{"filePath":"src/main.ts"}
  const idx = text.indexOf(':')
  if (idx <= 0) return null
  const tab = normalizeTemplateTab(text.slice(0, idx))
  if (!tab) return null
  const queryRaw = text.slice(idx + 1)
  if (!queryRaw) return { tab }

  try {
    const parsedQuery = JSON.parse(queryRaw) as unknown
    if (!parsedQuery || typeof parsedQuery !== 'object' || Array.isArray(parsedQuery)) return null
    const query = normalizeStringRecord(parsedQuery)
    return {
      tab,
      ...(Object.keys(query).length ? { query } : {}),
    }
  } catch {
    return null
  }
}

export function readWorkspaceWindowDragIdFromDataTransfer(dataTransfer: DataTransfer | null | undefined): string {
  if (!dataTransfer) return ''
  const fromMime = String(dataTransfer.getData(WORKSPACE_WINDOW_DRAG_MIME) || '').trim()
  if (fromMime) return fromMime
  return ''
}

function getDataTransferTypes(dataTransfer: DataTransfer | null | undefined): string[] {
  if (!dataTransfer) return []
  return Array.from(dataTransfer.types || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

function normalizeStringRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = String(key || '').trim()
    const v = String(value || '').trim()
    if (!k || !v) continue
    out[k] = v
  }
  return out
}

function normalizeMatchKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const key = String(item || '').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

function normalizeTemplateTab(raw: unknown): WorkspaceWindowTemplateDragData['tab'] | '' {
  const value = String(raw || '').trim()
  if (
    value === 'chat' ||
    value === 'files' ||
    value === 'preview' ||
    value === 'terminal' ||
    value === 'git' ||
    value === 'settings'
  ) {
    return value
  }
  return ''
}

function normalizeTemplatePayload(raw: unknown): WorkspaceWindowTemplateDragData | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const tab = normalizeTemplateTab(source.tab)
  if (!tab) return null

  const query = normalizeStringRecord(source.query)
  const title = String(source.title || '').trim()
  const matchKeys = normalizeMatchKeys(source.matchKeys)
  const windowId = String(source.windowId || '').trim()

  return {
    tab,
    ...(Object.keys(query).length ? { query } : {}),
    ...(title ? { title } : {}),
    ...(matchKeys.length ? { matchKeys } : {}),
    ...(windowId ? { windowId } : {}),
  }
}

export function writeWorkspaceWindowTemplateToDataTransfer(
  dataTransfer: DataTransfer | null | undefined,
  payload: WorkspaceWindowTemplateDragData,
): boolean {
  if (!dataTransfer) return false

  const normalized = normalizeTemplatePayload(payload)
  if (!normalized) return false

  let wroteAny = false

  // Always write plain text fallback first so drag/drop remains usable even when
  // custom MIME types are restricted by the runtime/browser.
  try {
    const plain = String(dataTransfer.getData('text/plain') || '').trim()
    if (!plain) {
      dataTransfer.setData('text/plain', templatePayloadToText(normalized))
    }
    wroteAny = true
  } catch {
    // ignore plain-text write failure and try custom MIME below
  }

  try {
    dataTransfer.setData(WORKSPACE_WINDOW_TEMPLATE_DRAG_MIME, JSON.stringify(normalized))
    wroteAny = true
  } catch {
    // ignore custom MIME write failure
  }

  return wroteAny
}

export function hasWorkspaceWindowDragDataTransfer(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false

  const types = getDataTransferTypes(dataTransfer)
  if (!types.length) return false
  if (types.includes(WORKSPACE_WINDOW_DRAG_MIME)) return true
  if (types.includes(WORKSPACE_WINDOW_TEMPLATE_DRAG_MIME)) return true
  return Boolean(readWorkspaceWindowTemplateFromDataTransfer(dataTransfer))
}

export function readWorkspaceWindowTemplateFromDataTransfer(
  dataTransfer: DataTransfer | null | undefined,
): WorkspaceWindowTemplateDragData | null {
  if (!dataTransfer) return null
  const raw = String(dataTransfer.getData(WORKSPACE_WINDOW_TEMPLATE_DRAG_MIME) || '').trim()
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown
      const normalized = normalizeTemplatePayload(parsed)
      if (normalized) return normalized
    } catch {
      // fall through to plain text fallback below
    }
  }

  const plain = String(dataTransfer.getData('text/plain') || '').trim()
  if (!plain) return null
  return parseTemplatePayloadFromText(plain)
}
