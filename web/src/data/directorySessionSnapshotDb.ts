import type { StrictJsonObject, StrictJsonValue } from '@/types/json'

export type DirectoryEntrySnapshot = {
  id: string
  path: string
  label?: string
}

export type SessionSummarySnapshot = StrictJsonObject & {
  id: string
}

export type SessionRuntimeSnapshot = {
  statusType?: string
  phase?: string
  attention?: 'permission' | 'question' | null
  updatedAt?: number
}

export type DirectorySessionSnapshot = {
  schemaVersion: 1
  savedAt: number
  directoryEntries: DirectoryEntrySnapshot[]
  sessionSummaries: SessionSummarySnapshot[]
  runtimeBySessionId: Record<string, SessionRuntimeSnapshot>
  rootsByDirectoryId: Record<string, string[]>
  childrenByParentSessionId: Record<string, string[]>
}

const DB_NAME = 'oc2.directorySessionSnapshot'
const DB_VERSION = 1
const STORE_NAME = 'snapshots'
const SNAPSHOT_KEY = 'latest'

let openDbPromise: Promise<IDBDatabase> | null = null

function hasIndexedDb(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
}

function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'))
  })
}

function requestResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'))
  })
}

function openSnapshotDb(): Promise<IDBDatabase> {
  if (!hasIndexedDb()) {
    return Promise.reject(new Error('IndexedDB not available'))
  }
  if (openDbPromise) return openDbPromise

  openDbPromise = new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'))
  })

  return openDbPromise
}

function asRecord(value: StrictJsonValue): StrictJsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

function normalizeStringArray(input: StrictJsonValue): string[] {
  if (!Array.isArray(input)) return []
  return input.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
}

function normalizeStringArrayMap(input: StrictJsonValue): Record<string, string[]> {
  const record = asRecord(input)
  if (!record) return {}
  const out: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(record)) {
    const id = String(k || '').trim()
    if (!id) continue
    out[id] = normalizeStringArray(v)
  }
  return out
}

function normalizeSnapshot(raw: StrictJsonValue): DirectorySessionSnapshot | null {
  const obj = asRecord(raw)
  if (!obj) return null

  const directoryEntries = Array.isArray(obj.directoryEntries)
    ? obj.directoryEntries
        .map((entry) => {
          const value = asRecord(entry)
          if (!value) return null
          const id = typeof value.id === 'string' ? value.id.trim() : ''
          const path = typeof value.path === 'string' ? value.path.trim() : ''
          const label = typeof value.label === 'string' ? value.label : undefined
          if (!id || !path) return null
          return { id, path, label }
        })
        .filter(Boolean)
    : []

  const sessionSummaries = Array.isArray(obj.sessionSummaries)
    ? obj.sessionSummaries
        .filter((entry) => {
          const value = asRecord(entry)
          const id = value && typeof value.id === 'string' ? value.id.trim() : ''
          return Boolean(id)
        })
        .map((entry) => entry as SessionSummarySnapshot)
    : []

  const runtimeBySessionId: Record<string, SessionRuntimeSnapshot> = {}
  const runtimeBySession = asRecord(obj.runtimeBySessionId)
  if (runtimeBySession) {
    for (const [sid, value] of Object.entries(runtimeBySession)) {
      const sessionId = String(sid || '').trim()
      if (!sessionId) continue
      const runtime = asRecord(value)
      if (!runtime) continue
      runtimeBySessionId[sessionId] = {
        statusType: typeof runtime.statusType === 'string' ? runtime.statusType : undefined,
        phase: typeof runtime.phase === 'string' ? runtime.phase : undefined,
        attention:
          runtime.attention === 'permission' || runtime.attention === 'question' || runtime.attention === null
            ? (runtime.attention as 'permission' | 'question' | null)
            : undefined,
        updatedAt:
          typeof runtime.updatedAt === 'number' && Number.isFinite(runtime.updatedAt) ? runtime.updatedAt : undefined,
      }
    }
  }

  return {
    schemaVersion: 1,
    savedAt: typeof obj.savedAt === 'number' && Number.isFinite(obj.savedAt) ? obj.savedAt : Date.now(),
    directoryEntries: directoryEntries as DirectoryEntrySnapshot[],
    sessionSummaries,
    runtimeBySessionId,
    rootsByDirectoryId: normalizeStringArrayMap(obj.rootsByDirectoryId),
    childrenByParentSessionId: normalizeStringArrayMap(obj.childrenByParentSessionId),
  }
}

export async function loadDirectorySessionSnapshot(): Promise<DirectorySessionSnapshot | null> {
  if (!hasIndexedDb()) return null
  try {
    const db = await openSnapshotDb()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const raw = (await requestResult(store.get(SNAPSHOT_KEY))) as StrictJsonValue
    return normalizeSnapshot(raw)
  } catch {
    return null
  }
}

export async function saveDirectorySessionSnapshot(snapshot: DirectorySessionSnapshot): Promise<void> {
  if (!hasIndexedDb()) return
  try {
    const db = await openSnapshotDb()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.put(
      {
        ...snapshot,
        schemaVersion: 1,
        savedAt: Date.now(),
      },
      SNAPSHOT_KEY,
    )
    await waitForTransaction(tx)
  } catch {
    // ignore persistence errors
  }
}

export async function clearDirectorySessionSnapshot(): Promise<void> {
  if (!hasIndexedDb()) return
  try {
    const db = await openSnapshotDb()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(SNAPSHOT_KEY)
    await waitForTransaction(tx)
  } catch {
    // ignore persistence errors
  }
}
