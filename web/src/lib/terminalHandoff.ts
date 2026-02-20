const TERMINAL_HANDOFF_KEY_PREFIX = 'oc2.terminal.handoff:'
const TERMINAL_HANDOFF_TTL_MS = 30_000
const TERMINAL_HANDOFF_MAX_PENDING = 12
const TERMINAL_HANDOFF_MAX_SEND_LEN = 12_000

const TOKEN_RE = /^[a-f0-9]{32}$/

type TerminalHandoffPayload = {
  v: 1
  send: string
  target?: TerminalHandoffTarget
  expiresAt: number
}

export type TerminalHandoffTarget = 'git'

export type ConsumedTerminalHandoff = {
  send: string
  target: TerminalHandoffTarget | null
}

function normalizeTarget(raw: unknown): TerminalHandoffTarget | null {
  if (raw === 'git') return 'git'
  return null
}

function normalizeSendPayload(raw: string): string | null {
  const normalized = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
  if (!normalized) return null
  if (normalized.length > TERMINAL_HANDOFF_MAX_SEND_LEN) return null
  return normalized
}

function randomToken(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/g, '')
    }
  } catch {
    // ignore
  }

  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const buf = new Uint8Array(16)
      crypto.getRandomValues(buf)
      return Array.from(buf)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    }
  } catch {
    // ignore
  }

  // Fallback should be extremely rare, but keep behavior deterministic.
  const seed = `${Date.now()}-${Math.random()}-${Math.random()}`
  let hash = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const base = (hash >>> 0).toString(16).padStart(8, '0')
  return `${base}${base}${base}${base}`
}

function parsePayload(raw: string): TerminalHandoffPayload | null {
  try {
    const parsed = JSON.parse(raw) as TerminalHandoffPayload
    if (parsed?.v !== 1) return null
    if (typeof parsed.send !== 'string') return null
    if (parsed.target !== undefined && normalizeTarget(parsed.target) === null) return null
    if (typeof parsed.expiresAt !== 'number' || !Number.isFinite(parsed.expiresAt)) return null
    return parsed
  } catch {
    return null
  }
}

function pruneHandoffs(now: number) {
  const active: Array<{ key: string; expiresAt: number }> = []

  try {
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i)
      if (!key || !key.startsWith(TERMINAL_HANDOFF_KEY_PREFIX)) continue
      const raw = sessionStorage.getItem(key)
      if (!raw) {
        sessionStorage.removeItem(key)
        continue
      }

      const payload = parsePayload(raw)
      if (!payload || payload.expiresAt <= now) {
        sessionStorage.removeItem(key)
        continue
      }

      active.push({ key, expiresAt: payload.expiresAt })
    }

    if (active.length <= TERMINAL_HANDOFF_MAX_PENDING) return
    active.sort((a, b) => a.expiresAt - b.expiresAt)
    const dropCount = active.length - TERMINAL_HANDOFF_MAX_PENDING
    for (let i = 0; i < dropCount; i += 1) {
      const candidate = active[i]
      if (!candidate) continue
      sessionStorage.removeItem(candidate.key)
    }
  } catch {
    // ignore storage access failures
  }
}

export function stageTrustedTerminalHandoff(send: string, opts?: { target?: TerminalHandoffTarget }): string | null {
  const payloadSend = normalizeSendPayload(send)
  if (!payloadSend) return null

  const payloadTarget = normalizeTarget(opts?.target)

  const now = Date.now()
  pruneHandoffs(now)
  const token = randomToken()
  if (!TOKEN_RE.test(token)) return null

  const payload: TerminalHandoffPayload = {
    v: 1,
    send: payloadSend,
    expiresAt: now + TERMINAL_HANDOFF_TTL_MS,
  }
  if (payloadTarget) {
    payload.target = payloadTarget
  }

  try {
    sessionStorage.setItem(`${TERMINAL_HANDOFF_KEY_PREFIX}${token}`, JSON.stringify(payload))
    return token
  } catch {
    return null
  }
}

export function consumeTrustedTerminalHandoffPayload(token: string): ConsumedTerminalHandoff | null {
  const id = String(token || '')
    .trim()
    .toLowerCase()
  if (!TOKEN_RE.test(id)) return null

  const key = `${TERMINAL_HANDOFF_KEY_PREFIX}${id}`

  try {
    const raw = sessionStorage.getItem(key)
    sessionStorage.removeItem(key)
    if (!raw) return null

    const payload = parsePayload(raw)
    if (!payload) return null
    if (payload.expiresAt <= Date.now()) return null
    const send = normalizeSendPayload(payload.send)
    if (!send) return null
    return {
      send,
      target: normalizeTarget(payload.target),
    }
  } catch {
    return null
  }
}

export function consumeTrustedTerminalHandoff(token: string): string | null {
  const payload = consumeTrustedTerminalHandoffPayload(token)
  return payload?.send || null
}
