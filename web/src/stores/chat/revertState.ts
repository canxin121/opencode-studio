import type { Session } from '../../types/chat'

function readRevertMessageId(session: Session | null | undefined): string {
  const messageID = session?.revert?.messageID
  return typeof messageID === 'string' ? messageID.trim() : ''
}

function normalizeMessageId(messageId: string): string {
  return typeof messageId === 'string' ? messageId.trim() : ''
}

export function shouldClearRevertBoundary(session: Session | null | undefined, messageId: string): boolean {
  const revertId = readRevertMessageId(session)
  const incomingId = normalizeMessageId(messageId)
  if (!revertId || !incomingId) return false
  return incomingId >= revertId
}

export function clearRevertBoundary(session: Session): Session {
  const next = { ...session }
  delete next.revert
  return next
}
