import type { JsonObject as PartRecord, JsonValue } from '@/types/json'

export type TranscriptOptions = {
  thinking: boolean
  toolDetails: boolean
  assistantMetadata: boolean
}

export type TranscriptSession = {
  id: string
  title?: string
  time?: { created?: number; updated?: number }
}

export type TranscriptMessage = {
  info: {
    role?: string
    agent?: string
    modelID?: string
    time?: { created?: number; completed?: number }
  }
  parts: JsonValue[]
}

function asPartRecord(part: JsonValue): PartRecord | null {
  return part && typeof part === 'object' ? (part as PartRecord) : null
}

function normalizeText(value: JsonValue): string {
  return typeof value === 'string' ? value : ''
}

function titleCase(raw: string): string {
  const v = raw.trim()
  if (!v) return ''
  return v
    .split(/[_-]/)
    .map((chunk) => (chunk ? chunk[0]!.toUpperCase() + chunk.slice(1) : ''))
    .join(' ')
}

function formatDurationMs(start?: number, end?: number): string {
  if (!start || !end || end <= start) return ''
  const sec = (end - start) / 1000
  return `${sec.toFixed(1)}s`
}

function isReasoningPart(part: JsonValue): boolean {
  const rec = asPartRecord(part)
  const t = normalizeText(rec?.type).toLowerCase()
  return t === 'reasoning' || t === 'thinking' || t === 'reasoning_content' || t === 'reasoning_details'
}

function isJustificationPart(part: JsonValue): boolean {
  const rec = asPartRecord(part)
  const t = normalizeText(rec?.type).toLowerCase()
  return t === 'justification'
}

function isToolPart(part: JsonValue): boolean {
  const rec = asPartRecord(part)
  const t = normalizeText(rec?.type).toLowerCase()
  if (t === 'tool') return true
  return !t && typeof rec?.tool === 'string' && Boolean(rec?.state)
}

function partText(part: JsonValue): string {
  const rec = asPartRecord(part)
  if (typeof rec?.text === 'string') return rec.text
  if (typeof rec?.content === 'string') return rec.content
  return ''
}

export function formatTranscript(
  session: TranscriptSession,
  messages: TranscriptMessage[],
  options: TranscriptOptions,
): string {
  const title = normalizeText(session.title) || session.id
  let transcript = `# ${title}\n\n`
  transcript += `**Session ID:** ${session.id}\n`
  if (session.time?.created) {
    transcript += `**Created:** ${new Date(session.time.created).toLocaleString()}\n`
  }
  if (session.time?.updated) {
    transcript += `**Updated:** ${new Date(session.time.updated).toLocaleString()}\n`
  }
  transcript += `\n---\n\n`

  for (const msg of messages) {
    transcript += formatMessage(msg, options)
    transcript += `---\n\n`
  }

  return transcript
}

function formatMessage(message: TranscriptMessage, options: TranscriptOptions): string {
  const role = normalizeText(message.info?.role).toLowerCase()
  let result = ''

  if (role === 'assistant') {
    result += formatAssistantHeader(message, options.assistantMetadata)
  } else if (role === 'user') {
    result += `## User\n\n`
  } else {
    result += `## ${role ? titleCase(role) : 'Message'}\n\n`
  }

  for (const part of message.parts || []) {
    result += formatPart(part, options)
  }

  return result
}

function formatAssistantHeader(message: TranscriptMessage, includeMetadata: boolean): string {
  if (!includeMetadata) return `## Assistant\n\n`

  const agent = normalizeText(message.info?.agent)
  const model = normalizeText(message.info?.modelID)
  const duration = formatDurationMs(message.info?.time?.created, message.info?.time?.completed)
  const meta = [agent && titleCase(agent), model, duration].filter(Boolean).join(' · ')
  return meta ? `## Assistant (${meta})\n\n` : `## Assistant\n\n`
}

function formatPart(part: JsonValue, options: TranscriptOptions): string {
  const rec = asPartRecord(part)

  if (rec?.type === 'text' && !rec?.synthetic && !rec?.ignored) {
    const text = partText(part)
    return text ? `${text}\n\n` : ''
  }

  if (isReasoningPart(part)) {
    if (!options.thinking) return ''
    const text = partText(part)
    return text ? `_Thinking:_\n\n${text}\n\n` : ''
  }

  if (isJustificationPart(part)) {
    if (!options.thinking) return ''
    const text = partText(part)
    return text ? `_Justification:_\n\n${text}\n\n` : ''
  }

  if (rec?.type === 'file') {
    const label = normalizeText(rec?.filename) || normalizeText(rec?.url) || 'attachment'
    return `_Attachment:_ ${label}\n\n`
  }

  if (isToolPart(part)) {
    if (!options.toolDetails) return ''
    const tool = normalizeText(rec?.tool) || 'tool'
    let result = `\`\`\`\nTool: ${tool}\n`
    const state = asPartRecord(rec?.state)
    const input = state?.input
    const output = state?.output ?? state?.result
    const error = state?.error
    if (input !== undefined) {
      result += `\n**Input:**\n\`\`\`json\n${safeJson(input)}\n\`\`\``
    }
    if (output !== undefined) {
      result += `\n**Output:**\n\`\`\`\n${safeText(output)}\n\`\`\``
    }
    if (error !== undefined) {
      result += `\n**Error:**\n\`\`\`\n${safeText(error)}\n\`\`\``
    }
    result += `\n\`\`\`\n\n`
    return result
  }

  return ''
}

function safeJson(value: JsonValue): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function safeText(value: JsonValue): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return safeJson(value)
}
