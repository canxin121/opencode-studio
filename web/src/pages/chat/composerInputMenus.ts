export type ComposerInputMenuKind = 'attachments' | 'actions' | 'picker'

type ComposerInputMenuClosers = {
  closeAttachments: () => void
  closeActions: () => void
  closePicker: () => void
}

export function closeAllComposerInputMenus(closers: ComposerInputMenuClosers) {
  closers.closeAttachments()
  closers.closeActions()
  closers.closePicker()
}

export function openComposerInputMenu(kind: ComposerInputMenuKind, closers: ComposerInputMenuClosers) {
  if (kind !== 'attachments') closers.closeAttachments()
  if (kind !== 'actions') closers.closeActions()
  if (kind !== 'picker') closers.closePicker()
}
