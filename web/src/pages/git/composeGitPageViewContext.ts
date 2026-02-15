type GitPageViewContextValues = Record<string, unknown>

export type GitPageViewContextGroup<T extends GitPageViewContextValues = GitPageViewContextValues> = {
  label: string
  values: T
}

type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (value: infer I) => void
  ? I
  : never

type GroupValues<T extends readonly GitPageViewContextGroup[]> =
  T[number] extends GitPageViewContextGroup<infer V> ? V : never

type ComposedGitPageViewContext<T extends readonly GitPageViewContextGroup[]> = UnionToIntersection<GroupValues<T>>

function isDevEnv(): boolean {
  const meta = import.meta as { env?: { DEV?: boolean } }
  return Boolean(meta.env?.DEV)
}

export function composeGitPageViewContext<const T extends readonly GitPageViewContextGroup[]>(
  groups: T,
): ComposedGitPageViewContext<T> {
  const merged: GitPageViewContextValues = {}
  const seenBy = new Map<string, string>()

  for (const group of groups) {
    for (const [key, value] of Object.entries(group.values)) {
      const existing = seenBy.get(key)
      if (existing) {
        const message = `[GitPage] duplicate view context key "${key}" from "${group.label}"; already provided by "${existing}"`
        if (isDevEnv()) {
          throw new Error(message)
        }
        continue
      }
      seenBy.set(key, group.label)
      merged[key] = value
    }
  }

  return merged as ComposedGitPageViewContext<T>
}
