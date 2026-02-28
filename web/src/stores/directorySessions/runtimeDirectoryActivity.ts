import { runtimeIsActive, type SessionRuntimeState } from '../directorySessionRuntime'
import type { SessionSummarySnapshot } from '../../data/directorySessionSnapshotDb'
import type { RunningIndexEntry } from './index'

function normalizeDirForCompare(path: string): string {
  return (path || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '')
}

function readSessionDirectory(summary: SessionSummarySnapshot | null | undefined): string {
  const raw = summary && typeof summary === 'object' ? (summary as { directory?: unknown }).directory : ''
  return typeof raw === 'string' ? raw.trim() : ''
}

export function hasActiveRuntimeInDirectoryScope(input: {
  directoryId: string
  directoryPath: string
  runtimeBySessionId: Record<string, SessionRuntimeState>
  directoryIdBySessionId: Record<string, string>
  sessionSummariesById: Record<string, SessionSummarySnapshot>
  runningIndex: RunningIndexEntry[]
  includeCooldown?: boolean
}): boolean {
  const did = (input.directoryId || '').trim()
  const pathNorm = normalizeDirForCompare(input.directoryPath)
  if (!did && !pathNorm) return false

  const runningBySessionId = new Map(input.runningIndex.map((item) => [item.sessionId, item]))

  for (const [sid, runtime] of Object.entries(input.runtimeBySessionId || {})) {
    if (!runtimeIsActive(runtime, { includeCooldown: input.includeCooldown })) continue

    const mappedDirectoryId = String(input.directoryIdBySessionId[sid] || '').trim()
    if (did && mappedDirectoryId === did) return true

    const running = runningBySessionId.get(sid)
    if (running) {
      const runningDirectoryId = String(running.directoryId || '').trim()
      if (did && runningDirectoryId === did) return true
      if (pathNorm && normalizeDirForCompare(String(running.directoryPath || '').trim()) === pathNorm) return true
    }

    if (pathNorm) {
      const summary = input.sessionSummariesById[sid]
      if (summary && normalizeDirForCompare(readSessionDirectory(summary)) === pathNorm) {
        return true
      }
    }
  }

  return false
}
