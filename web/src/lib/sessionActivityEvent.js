// Normalize the synthetic opencode-studio activity SSE event into a { sessionID, phase } update.
// Prefer OpenCode's authoritative lifecycle events (session.status/session.idle/session.error).
// Also accept opencode-studio:session-activity injected events (e.g. cooldown) when available.

function trimString(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function readSessionId(props) {
  const p = props && typeof props === 'object' ? props : {}
  return trimString(p.sessionID || p.sessionId || p.session_id)
}

/**
 * @param {unknown} evt
 * @returns {{ sessionID: string, phase: 'idle'|'busy'|'cooldown' } | null}
 */
export function extractSessionActivityUpdate(evt) {
  const type = trimString(evt && evt.type)
  if (!type) return null

  // Prefer OpenCode's authoritative session lifecycle signals.
  if (type === 'session.status') {
    const props = (evt && evt.properties) || {}
    const sessionID = readSessionId(props)
    const status = props.status || {}
    const statusType = trimString(status && status.type)
    if (!sessionID) return null

    if (statusType === 'busy' || statusType === 'retry') {
      return { sessionID, phase: 'busy' }
    }
    if (statusType === 'idle') {
      return { sessionID, phase: 'idle' }
    }
  }

  if (type === 'session.idle') {
    const props = (evt && evt.properties) || {}
    const sessionID = readSessionId(props)
    if (!sessionID) return null
    return { sessionID, phase: 'idle' }
  }

  if (type === 'session.error') {
    const props = (evt && evt.properties) || {}
    const sessionID = readSessionId(props)
    if (!sessionID) return null
    return { sessionID, phase: 'idle' }
  }

  if (type === 'opencode-studio:session-activity') {
    const props = (evt && evt.properties) || {}
    const sessionID = readSessionId(props)
    const phase = trimString(props.phase)
    if (!sessionID) return null
    if (phase !== 'idle' && phase !== 'busy' && phase !== 'cooldown') return null
    return { sessionID, phase }
  }

  return null
}
