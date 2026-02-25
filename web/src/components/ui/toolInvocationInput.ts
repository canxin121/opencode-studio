type InputValue = unknown
type InputRecord = Record<string, InputValue>

function isRecord(value: InputValue): value is InputRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: InputValue): InputRecord {
  return isRecord(value) ? value : {}
}

function toDisplayString(value: InputValue): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function resolveToolInputDisplay(
  toolName: string,
  input: InputValue,
): {
  text: string
  lang: string
} {
  const t = String(toolName || '')
    .trim()
    .toLowerCase()
  const inp = asRecord(input)

  if (t === 'bash' && typeof inp.command === 'string' && inp.command) {
    return {
      text: inp.command,
      lang: 'bash',
    }
  }

  if (t === 'write') {
    if (typeof inp.content === 'string' && inp.content) {
      return { text: inp.content, lang: 'text' }
    }
    if (typeof inp.text === 'string' && inp.text) {
      return { text: inp.text, lang: 'text' }
    }
  }

  const keys = Object.keys(inp)
  if (keys.length === 0) {
    return {
      text: '',
      lang: 'json',
    }
  }

  return {
    text: toDisplayString(inp),
    lang: 'json',
  }
}
