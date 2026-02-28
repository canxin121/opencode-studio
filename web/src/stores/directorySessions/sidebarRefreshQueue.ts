export type StringRefreshQueueOptions = {
  maxItems: number
}

export type StringRefreshQueue = {
  enqueue: (key: string) => { accepted: boolean; dropped: string | null }
  shift: () => string | null
  clear: () => void
  size: () => number
}

export function createStringRefreshQueue(options: StringRefreshQueueOptions): StringRefreshQueue {
  const maxItems = Math.max(1, Math.floor(options.maxItems || 1))
  const ordered: string[] = []
  const known = new Set<string>()

  const enqueue = (rawKey: string): { accepted: boolean; dropped: string | null } => {
    const key = String(rawKey || '').trim()
    if (!key) return { accepted: false, dropped: null }
    if (known.has(key)) return { accepted: false, dropped: null }

    let dropped: string | null = null
    if (ordered.length >= maxItems) {
      dropped = ordered.shift() || null
      if (dropped) known.delete(dropped)
    }

    ordered.push(key)
    known.add(key)
    return { accepted: true, dropped }
  }

  const shift = (): string | null => {
    const key = ordered.shift() || null
    if (key) known.delete(key)
    return key
  }

  const clear = () => {
    ordered.length = 0
    known.clear()
  }

  return {
    enqueue,
    shift,
    clear,
    size: () => ordered.length,
  }
}
