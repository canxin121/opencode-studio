// Runtime-only helpers for OpenCode Settings UI.
// Keep these as plain JS so they can be imported by Node tests without TS tooling.

function unrefLike(v) {
  // Vue refs/computeds are objects with a .value; this is good enough for our usage.
  if (v && typeof v === 'object' && 'value' in v) return v.value
  return v
}

// Settings sections use a deliberately loose context that sometimes stores
// either raw values or refs/computeds. This helper normalizes that shape.
export function asStringArray(v) {
  const raw = unrefLike(v)
  if (!Array.isArray(raw)) return []
  return raw.map((s) => String(s))
}
