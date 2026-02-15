import { computed, watch, type ComputedRef, type Ref } from 'vue'

import { directoryEntryLabel, includesQuery } from '@/features/sessions/model/labels'
import type { DirectoryEntry, Project } from '@/features/sessions/model/types'
import type { JsonValue as JsonLike } from '@/types/json'

function asRecord(value: JsonLike): Record<string, JsonLike> {
  return typeof value === 'object' && value !== null ? (value as Record<string, JsonLike>) : {}
}

function toTrimmedString(value: JsonLike): string {
  if (typeof value === 'string') return value.trim()
  return String(value || '').trim()
}

export function normalizeDirectories(raw: JsonLike): DirectoryEntry[] {
  const list = Array.isArray(raw) ? raw : []
  return list
    .map((p) => {
      const rec = asRecord(p)
      return {
        id: toTrimmedString(rec.id),
        path: toTrimmedString(rec.path),
        label: typeof rec.label === 'string' ? rec.label : undefined,
      }
    })
    .map((p) => ({ ...p, id: p.id || p.path }))
    .filter((p) => Boolean(p.id) && Boolean(p.path))
}

export function normalizeProjects(raw: JsonLike): Project[] {
  return normalizeDirectories(raw)
}

export function useSidebarDirectoryPaging(opts: {
  directories: ComputedRef<DirectoryEntry[]>
  queryNorm: ComputedRef<string>
  directoryPage: Ref<number>
  pageSize: number
}) {
  const visibleDirectories = computed<DirectoryEntry[]>(() => {
    const q = opts.queryNorm.value
    if (!q) return opts.directories.value
    return opts.directories.value.filter((p) => {
      return includesQuery(directoryEntryLabel(p), q) || includesQuery(p.path, q) || includesQuery(p.id, q)
    })
  })

  const directoryPageCount = computed(() => {
    return Math.max(1, Math.ceil(visibleDirectories.value.length / opts.pageSize))
  })

  const pagedDirectories = computed(() => {
    const start = opts.directoryPage.value * opts.pageSize
    return visibleDirectories.value.slice(start, start + opts.pageSize)
  })

  watch(
    () => visibleDirectories.value.length,
    () => {
      const maxPage = Math.max(0, directoryPageCount.value - 1)
      if (opts.directoryPage.value > maxPage) opts.directoryPage.value = maxPage
    },
  )

  return { pagedDirectories, directoryPageCount, visibleDirectories }
}

export function useSidebarProjectPaging(opts: {
  projects: ComputedRef<Project[]>
  queryNorm: ComputedRef<string>
  projectPage: Ref<number>
  pageSize: number
}) {
  const { pagedDirectories, directoryPageCount, visibleDirectories } = useSidebarDirectoryPaging({
    directories: opts.projects,
    queryNorm: opts.queryNorm,
    directoryPage: opts.projectPage,
    pageSize: opts.pageSize,
  })
  return {
    pagedProjects: pagedDirectories,
    projectPageCount: directoryPageCount,
    visibleProjects: visibleDirectories,
  }
}
