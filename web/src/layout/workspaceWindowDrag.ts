export const WORKSPACE_WINDOW_DRAG_MIME = 'application/x-opencode-workspace-window-id'

export function readWorkspaceWindowDragIdFromDataTransfer(dataTransfer: DataTransfer | null | undefined): string {
  if (!dataTransfer) return ''
  const fromMime = String(dataTransfer.getData(WORKSPACE_WINDOW_DRAG_MIME) || '').trim()
  if (fromMime) return fromMime
  return String(dataTransfer.getData('text/plain') || '').trim()
}
