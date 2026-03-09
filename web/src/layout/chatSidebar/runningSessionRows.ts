type SessionLike = {
  id: string
  parentID?: string | null
  parentId?: string | null
  parent_id?: string | null
  [k: string]: unknown
}

export type RunningSessionRow = {
  id: string
  session: SessionLike | null
  renderKey: string
  depth: number
  parentId: string | null
  rootId: string
  isParent: boolean
  isExpanded: boolean
  [k: string]: unknown
}

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parentIdFromRow(row: RunningSessionRow): string | null {
  const fromRow = nonEmptyString(row.parentId)
  if (fromRow) return fromRow

  const fromSession = nonEmptyString(row.session?.parentID ?? row.session?.parentId ?? row.session?.parent_id)
  return fromSession || null
}

function inferParentByDepth(rows: RunningSessionRow[]): Record<string, string | null> {
  const inferred: Record<string, string | null> = {}
  const stack: Array<{ id: string; depth: number; rootId: string }> = []

  for (const row of rows) {
    const depth = Number.isFinite(Number(row.depth)) ? Math.max(0, Math.floor(Number(row.depth))) : 0
    const rootId = nonEmptyString(row.rootId) || row.id

    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop()
    }

    let parentId: string | null = null
    if (depth > 0) {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        const candidate = stack[i]
        if (candidate.rootId !== rootId) continue
        if (candidate.depth === depth - 1) {
          parentId = candidate.id
          break
        }
      }
    }

    inferred[row.id] = parentId
    stack.push({ id: row.id, depth, rootId })
  }

  return inferred
}

function resolvedParentById(rows: RunningSessionRow[]): Record<string, string | null> {
  const byId = new Set(rows.map((row) => row.id))
  const inferred = inferParentByDepth(rows)
  const parentById: Record<string, string | null> = {}

  for (const row of rows) {
    const explicit = parentIdFromRow(row)
    if (explicit && explicit !== row.id && byId.has(explicit)) {
      parentById[row.id] = explicit
      continue
    }
    const fallback = inferred[row.id]
    parentById[row.id] = fallback && fallback !== row.id && byId.has(fallback) ? fallback : null
  }

  return parentById
}

function visibleRowsByExpansion(
  rows: RunningSessionRow[],
  parentById: Record<string, string | null>,
  expandedParents: Set<string>,
): Set<string> {
  const visible = new Set<string>()

  for (const row of rows) {
    const parentId = parentById[row.id]
    if (!parentId) {
      visible.add(row.id)
      continue
    }

    let cur: string | null = parentId
    const seen = new Set<string>()
    let show = true
    while (cur) {
      if (seen.has(cur)) break
      seen.add(cur)
      if (!expandedParents.has(cur)) {
        show = false
        break
      }
      cur = parentById[cur] || null
    }

    if (show) visible.add(row.id)
  }

  return visible
}

function depthByParent(id: string, parentById: Record<string, string | null>, seen: Set<string>): number {
  const parent = parentById[id]
  if (!parent) return 0
  if (seen.has(id)) return 0
  const nextSeen = new Set(seen)
  nextSeen.add(id)
  return 1 + depthByParent(parent, parentById, nextSeen)
}

export function buildRunningSessionRows(rows: RunningSessionRow[], expandedParents: Set<string>): RunningSessionRow[] {
  const parentById = resolvedParentById(rows)
  const childrenByParent = new Map<string, string[]>()
  for (const row of rows) {
    const parentId = parentById[row.id]
    if (!parentId) continue
    const children = childrenByParent.get(parentId) || []
    children.push(row.id)
    childrenByParent.set(parentId, children)
  }

  const visibleIds = visibleRowsByExpansion(rows, parentById, expandedParents)
  return rows
    .filter((row) => visibleIds.has(row.id))
    .map((row) => {
      const isParent = (childrenByParent.get(row.id) || []).length > 0
      const depth = depthByParent(row.id, parentById, new Set())
      return {
        ...row,
        parentId: parentById[row.id],
        isParent,
        isExpanded: isParent && expandedParents.has(row.id),
        depth,
      }
    })
}
