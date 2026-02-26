import { nextTick, type Ref } from 'vue'

type PickerKind = 'agent' | 'model' | 'variant'
type AnchorLike =
  | HTMLElement
  | { triggerEl?: unknown; $el?: unknown; getBoundingClientRect?: () => DOMRect | undefined }
  | null

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function resolveAnchorRect(anchor: AnchorLike): DOMRect | null {
  if (!anchor) return null
  if (anchor instanceof HTMLElement) return anchor.getBoundingClientRect()
  if (typeof anchor !== 'object') return null

  const triggerEl = (anchor as { triggerEl?: unknown }).triggerEl
  if (triggerEl instanceof HTMLElement) return triggerEl.getBoundingClientRect()

  const rootEl = (anchor as { $el?: unknown }).$el
  if (rootEl instanceof HTMLElement) return rootEl.getBoundingClientRect()

  const getRect = (anchor as { getBoundingClientRect?: () => DOMRect | undefined }).getBoundingClientRect
  if (typeof getRect === 'function') return getRect() || null

  return null
}

export function useModelSelectionPickerUi(opts: {
  composerControlsRef: Ref<HTMLDivElement | null>
  composerPickerOpen: Ref<null | PickerKind>
  composerPickerStyle: Ref<Record<string, string>>
  agentTriggerRef: Ref<AnchorLike>
  modelTriggerRef: Ref<AnchorLike>
  variantTriggerRef: Ref<AnchorLike>
  modelPickerQuery: Ref<string>
  agentPickerQuery: Ref<string>
  onOpenComposerPicker: () => void
  commandOpen: Ref<boolean>
  commandQuery: Ref<string>
  commandIndex: Ref<number>
}) {
  const {
    composerControlsRef,
    composerPickerOpen,
    composerPickerStyle,
    agentTriggerRef,
    modelTriggerRef,
    variantTriggerRef,
    modelPickerQuery,
    agentPickerQuery,
    onOpenComposerPicker,
    commandOpen,
    commandQuery,
    commandIndex,
  } = opts

  function closeComposerPicker() {
    composerPickerOpen.value = null
  }

  function toggleComposerPicker(kind: PickerKind) {
    if (composerPickerOpen.value === kind) {
      composerPickerOpen.value = null
      return
    }

    onOpenComposerPicker()
    commandOpen.value = false
    commandQuery.value = ''
    commandIndex.value = 0
    composerPickerOpen.value = kind

    void nextTick(() => {
      const box = composerControlsRef.value
      const anchor =
        kind === 'agent' ? agentTriggerRef.value : kind === 'model' ? modelTriggerRef.value : variantTriggerRef.value
      const anchorRect = resolveAnchorRect(anchor)
      if (!box || !anchorRect) {
        composerPickerStyle.value = { left: '8px' }
        return
      }

      const boxRect = box.getBoundingClientRect()

      const padding = 8
      const boxWidth = Math.max(0, boxRect.width)
      const maxWidth = Math.max(240, Math.round(Math.min(520, boxWidth - padding * 2)))
      const rawLeft = Math.round(anchorRect.left - boxRect.left)
      const maxLeft = Math.max(padding, Math.round(boxWidth - padding - maxWidth))
      const left = clampNumber(rawLeft, padding, maxLeft)
      composerPickerStyle.value = { left: `${left}px`, maxWidth: `${maxWidth}px` }
    })

    if (kind === 'model') {
      modelPickerQuery.value = ''
    } else if (kind === 'agent') {
      agentPickerQuery.value = ''
    }
  }

  return {
    closeComposerPicker,
    toggleComposerPicker,
  }
}
