// Small, dependency-free helpers shared between the UI and tests.
// Keep behavior stable; this is best-effort glob semantics.

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function globToRegExp(pattern) {
  let p = String(pattern || '')
  if (!p) return /^$/
  if (p === '*') return /^.*$/

  let re = '^'
  for (let i = 0; i < p.length; i += 1) {
    const ch = p[i]
    const next = p[i + 1]
    if (ch === '*' && next === '*') {
      re += '.*'
      i += 1
      continue
    }
    if (ch === '*') {
      re += '[^/]*'
      continue
    }
    if (ch === '?') {
      re += '[^/]'
      continue
    }
    re += escapeRegExp(ch)
  }
  re += '$'
  return new RegExp(re)
}

export function matchPattern(pattern, input) {
  const p = String(pattern || '').trim()
  const s = String(input || '')
  if (!p) return false
  const rx = globToRegExp(p)
  if (rx.test(s)) return true

  // If pattern doesn't include '/', also try basename matching.
  if (!p.includes('/') && s.includes('/')) {
    const base = s.split('/').pop() || s
    return rx.test(base)
  }
  return false
}
