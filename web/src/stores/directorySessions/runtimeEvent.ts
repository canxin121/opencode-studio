import type { SessionRuntimeState } from '../directorySessionRuntime'

export function runtimePatchWithEventTimestamp(
  patch: Partial<SessionRuntimeState>,
  eventUpdatedAt: number | undefined,
  nowMs = Date.now(),
): Partial<SessionRuntimeState> {
  return {
    ...patch,
    updatedAt: eventUpdatedAt ?? nowMs,
  }
}
