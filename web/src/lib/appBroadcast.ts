import { localStorageKeys, sessionStorageKeys } from './persistence/storageKeys'

type BroadcastPayload = unknown

export type AppBroadcastMessage = {
  type: string
  ts: number
  senderId: string
  payload?: BroadcastPayload
}

const CHANNEL_NAME = 'studio'
const STORAGE_KEY = localStorageKeys.broadcast.channelFallbackEvent
const SENDER_ID_KEY = sessionStorageKeys.broadcast.senderId

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  } catch {
    // ignore
  }
  return `${Date.now()}-${Math.random()}`
}

function getSenderId(): string {
  try {
    const existing = sessionStorage.getItem(SENDER_ID_KEY)
    if (existing && existing.trim()) return existing.trim()
    const id = randomId()
    sessionStorage.setItem(SENDER_ID_KEY, id)
    return id
  } catch {
    return randomId()
  }
}

function safeParse(raw: string | null): AppBroadcastMessage | null {
  const txt = String(raw || '').trim()
  if (!txt) return null
  try {
    const obj = JSON.parse(txt) as Partial<AppBroadcastMessage>
    if (!obj || typeof obj !== 'object') return null
    const type = typeof obj.type === 'string' ? obj.type.trim() : ''
    const senderId = typeof obj.senderId === 'string' ? obj.senderId.trim() : ''
    const ts = typeof obj.ts === 'number' && Number.isFinite(obj.ts) ? Math.max(0, Math.floor(obj.ts)) : 0
    if (!type || !senderId) return null
    return { type, senderId, ts, payload: obj.payload }
  } catch {
    return null
  }
}

type Subscriber = (msg: AppBroadcastMessage) => void

let initialized = false
let bc: BroadcastChannel | null = null
let storageHandler: ((evt: StorageEvent) => void) | null = null
const subscribers = new Set<Subscriber>()
const senderId = getSenderId()

function deliver(msg: AppBroadcastMessage) {
  if (!msg || msg.senderId === senderId) return
  for (const fn of subscribers) {
    try {
      fn(msg)
    } catch {
      // ignore
    }
  }
}

function ensureInitialized() {
  if (initialized) return
  initialized = true

  if (typeof window === 'undefined') return

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      bc = new BroadcastChannel(CHANNEL_NAME)
      bc.onmessage = (evt: MessageEvent) => {
        const msg = evt?.data as AppBroadcastMessage
        if (!msg || typeof msg !== 'object') return
        const type = typeof msg.type === 'string' ? msg.type.trim() : ''
        const from = typeof msg.senderId === 'string' ? msg.senderId.trim() : ''
        const ts = typeof msg.ts === 'number' && Number.isFinite(msg.ts) ? msg.ts : 0
        if (!type || !from) return
        deliver({ type, senderId: from, ts, payload: (msg as { payload?: unknown }).payload })
      }
      return
    } catch {
      bc = null
    }
  }

  // Fallback: localStorage events.
  storageHandler = (evt: StorageEvent) => {
    if (!evt) return
    if (evt.key !== STORAGE_KEY) return
    const msg = safeParse(evt.newValue)
    if (!msg) return
    deliver(msg)
  }
  window.addEventListener('storage', storageHandler)
}

export function postAppBroadcast(type: string, payload?: BroadcastPayload) {
  const ty = String(type || '').trim()
  if (!ty) return
  ensureInitialized()
  const msg: AppBroadcastMessage = { type: ty, ts: Date.now(), senderId, payload }
  if (bc) {
    try {
      bc.postMessage(msg)
      return
    } catch {
      // ignore
    }
  }
  try {
    // Changing value each time ensures storage event fires.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msg))
  } catch {
    // ignore
  }
}

export function subscribeAppBroadcast(fn: Subscriber): () => void {
  ensureInitialized()
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

export function closeAppBroadcast() {
  if (bc) {
    try {
      bc.close()
    } catch {
      // ignore
    }
    bc = null
  }
  if (storageHandler) {
    try {
      window.removeEventListener('storage', storageHandler)
    } catch {
      // ignore
    }
    storageHandler = null
  }
  subscribers.clear()
  initialized = false
}
