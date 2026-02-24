export type ComposerPrimaryActionState = {
  canAbort: boolean
  aborting: boolean
  canSend: boolean
  sending: boolean
}

export type ComposerPrimaryActionsResolved = {
  showStop: boolean
  stopDisabled: boolean
  sendDisabled: boolean
}

export function resolveComposerPrimaryActions(state: ComposerPrimaryActionState): ComposerPrimaryActionsResolved {
  const canAbort = Boolean(state.canAbort)
  const aborting = Boolean(state.aborting)
  const canSend = Boolean(state.canSend)
  const sending = Boolean(state.sending)

  return {
    showStop: canAbort || aborting,
    stopDisabled: !canAbort || aborting,
    sendDisabled: !canSend || sending,
  }
}
