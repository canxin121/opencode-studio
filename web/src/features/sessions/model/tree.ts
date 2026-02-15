import type { JsonValue as JsonLike } from '@/types/json'

export type FlatTreeRow = {
  id: string
  session: SessionLike
  depth: number
  isParent: boolean
  isExpanded: boolean
  rootId: string
}

export type SessionLike = {
  id: string
  time?: { updated?: number | null } | null
  parentID?: string | null
  parentId?: string | null
  parent_id?: string | null
  [k: string]: JsonLike
}

function getParentId(s: SessionLike): string | null {
  const raw = s.parentID ?? s.parentId ?? s.parent_id
  const pid = typeof raw === 'string' ? raw.trim() : ''
  return pid || null
}

export function buildFlattenedTree(
  list: SessionLike[],
  expandedParents: Set<string>,
): {
  rows: FlatTreeRow[]
  parentById: Record<string, string | null>
  rootIds: string[]
} {
  const byId = new Map<string, SessionLike>()
  for (const s of list) {
    if (s?.id) byId.set(s.id, s)
  }

  const childrenById = new Map<string, string[]>()
  const parentById: Record<string, string | null> = {}
  const roots: string[] = []

  for (const s of byId.values()) {
    const pid = getParentId(s)
    parentById[s.id] = pid
    if (pid && byId.has(pid)) {
      const arr = childrenById.get(pid) || []
      arr.push(s.id)
      childrenById.set(pid, arr)
    } else {
      roots.push(s.id)
    }
  }

  const getUpdatedTime = (id: string): number => {
    const raw = byId.get(id)?.time?.updated
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
  }

  const sortIds = (ids: string[]) => ids.slice().sort((a, b) => getUpdatedTime(b) - getUpdatedTime(a))

  const rows: FlatTreeRow[] = []
  const walk = (id: string, depth: number, rootId: string) => {
    const s = byId.get(id)
    if (!s) return
    const kids = sortIds(childrenById.get(id) || [])
    const isParent = kids.length > 0
    const isExpanded = expandedParents.has(id)

    rows.push({ id, session: s, depth, isParent, isExpanded, rootId })
    if (!isParent || !isExpanded) return
    for (const childId of kids) {
      walk(childId, depth + 1, rootId)
    }
  }

  const rootIds = sortIds(roots)
  for (const rid of rootIds) {
    walk(rid, 0, rid)
  }

  return { rows, parentById, rootIds }
}
