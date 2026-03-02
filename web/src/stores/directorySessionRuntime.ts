import type { SessionRuntimeSnapshot } from '../data/directorySessionSnapshotDb'

export type SessionRuntimeState = {
  statusType: 'idle' | 'busy' | 'retry' | 'unknown'
  phase: 'idle' | 'busy' | 'cooldown' | 'unknown'
  attention: 'permission' | 'question' | null
  displayState: 'idle' | 'running' | 'retrying' | 'coolingDown' | 'needsPermission' | 'needsReply' | 'unknown'
  updatedAt: number
}

type RuntimeInput = Partial<SessionRuntimeState> | SessionRuntimeSnapshot | null | undefined

export function normalizeRuntime(input?: RuntimeInput): SessionRuntimeState {
  const statusType =
    input?.statusType === 'idle' || input?.statusType === 'busy' || input?.statusType === 'retry'
      ? input.statusType
      : 'unknown'
  const phase =
    input?.phase === 'idle' || input?.phase === 'busy' || input?.phase === 'cooldown' ? input.phase : 'unknown'
  const attention = input?.attention === 'permission' || input?.attention === 'question' ? input.attention : null
  const displayState =
    input?.displayState === 'idle' ||
    input?.displayState === 'running' ||
    input?.displayState === 'retrying' ||
    input?.displayState === 'coolingDown' ||
    input?.displayState === 'needsPermission' ||
    input?.displayState === 'needsReply'
      ? input.displayState
      : 'unknown'
  const updatedAt = typeof input?.updatedAt === 'number' && Number.isFinite(input.updatedAt) ? input.updatedAt : 0
  return { statusType, phase, attention, displayState, updatedAt }
}

function readIncomingUpdatedAt(input: RuntimeInput): { provided: boolean; value: number } {
  if (!input || typeof input !== 'object') {
    return { provided: false, value: 0 }
  }
  if (!Object.prototype.hasOwnProperty.call(input, 'updatedAt')) {
    return { provided: false, value: 0 }
  }

  const raw = (input as { updatedAt?: number }).updatedAt
  const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0
  return { provided: true, value }
}

function readIncomingAttention(input: RuntimeInput): { provided: boolean; value: 'permission' | 'question' | null } {
  if (!input || typeof input !== 'object') {
    return { provided: false, value: null }
  }
  if (!Object.prototype.hasOwnProperty.call(input, 'attention')) {
    return { provided: false, value: null }
  }
  const raw = (input as { attention?: 'permission' | 'question' | null }).attention
  if (raw === null || raw === 'permission' || raw === 'question') {
    return { provided: true, value: raw }
  }
  return { provided: false, value: null }
}

export function mergeRuntimeState(
  current: SessionRuntimeState | undefined,
  incomingRaw: RuntimeInput,
): SessionRuntimeState {
  const incoming = normalizeRuntime(incomingRaw)
  const incomingUpdatedAt = readIncomingUpdatedAt(incomingRaw)

  if (!current) {
    return normalizeRuntime({
      ...incoming,
      updatedAt: incomingUpdatedAt.provided ? incomingUpdatedAt.value : 0,
    })
  }

  const existing = normalizeRuntime(current)
  const preferIncoming = incomingUpdatedAt.provided
    ? incomingUpdatedAt.value >= existing.updatedAt
    : existing.updatedAt <= 0

  const statusType = preferIncoming
    ? incoming.statusType !== 'unknown'
      ? incoming.statusType
      : existing.statusType
    : existing.statusType !== 'unknown'
      ? existing.statusType
      : incoming.statusType

  const phase = preferIncoming
    ? incoming.phase !== 'unknown'
      ? incoming.phase
      : existing.phase
    : existing.phase !== 'unknown'
      ? existing.phase
      : incoming.phase

  const incomingAttention = readIncomingAttention(incomingRaw)
  const attention = incomingAttention.provided && preferIncoming ? incomingAttention.value : existing.attention
  const displayState = preferIncoming
    ? incoming.displayState !== 'unknown'
      ? incoming.displayState
      : existing.displayState
    : existing.displayState !== 'unknown'
      ? existing.displayState
      : incoming.displayState

  return normalizeRuntime({
    statusType,
    phase,
    attention,
    displayState,
    updatedAt: incomingUpdatedAt.provided ? Math.max(existing.updatedAt, incomingUpdatedAt.value) : existing.updatedAt,
  })
}

export function runtimeIsActive(runtime?: SessionRuntimeState | null, opts?: { includeCooldown?: boolean }): boolean {
  if (!runtime) return false
  if (runtime.displayState === 'needsPermission' || runtime.displayState === 'needsReply') return true
  if (runtime.displayState === 'running' || runtime.displayState === 'retrying') return true
  if (opts?.includeCooldown && runtime.displayState === 'coolingDown') return true
  if (runtime.attention) return true
  if (runtime.statusType === 'busy' || runtime.statusType === 'retry') return true
  if (runtime.phase === 'busy') return true
  if (opts?.includeCooldown && runtime.phase === 'cooldown') return true
  return false
}

export function runtimeStateEquivalent(left: SessionRuntimeState, right: SessionRuntimeState): boolean {
  return (
    left.statusType === right.statusType &&
    left.phase === right.phase &&
    left.attention === right.attention &&
    left.displayState === right.displayState
  )
}
