import { isRef, nextTick, type Ref } from 'vue'

type PickerKind = 'agent' | 'model' | 'variant'
type AnchorLike =
  | HTMLElement
  | { triggerEl?: unknown; $el?: unknown; getBoundingClientRect?: () => DOMRect | undefined }
  | null

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function unwrapAnchorCandidate(value: unknown): unknown {
  let current = value
  for (let i = 0; i < 4; i += 1) {
    if (!isRef(current)) return current
    current = current.value
  }
  return current
}

function resolveAnchorRect(anchor: AnchorLike): DOMRect | null {
  const raw = unwrapAnchorCandidate(anchor)
  if (!raw) return null
  if (raw instanceof HTMLElement) return raw.getBoundingClientRect()
  if (typeof raw !== 'object') return null

  const triggerEl = unwrapAnchorCandidate((raw as { triggerEl?: unknown }).triggerEl)
  if (triggerEl instanceof HTMLElement) return triggerEl.getBoundingClientRect()

  if (triggerEl && typeof triggerEl === 'object') {
    const triggerHostEl = unwrapAnchorCandidate((triggerEl as { $el?: unknown }).$el)
    if (triggerHostEl instanceof HTMLElement) return triggerHostEl.getBoundingClientRect()
  }

  const rootEl = unwrapAnchorCandidate((raw as { $el?: unknown }).$el)
  if (rootEl instanceof HTMLElement) return rootEl.getBoundingClientRect()

  const getRect = (raw as { getBoundingClientRect?: () => DOMRect | undefined }).getBoundingClientRect
  if (typeof getRect === 'function') return getRect() || null

  if (triggerEl && typeof triggerEl === 'object') {
    const triggerGetRect = (triggerEl as { getBoundingClientRect?: () => DOMRect | undefined }).getBoundingClientRect
    if (typeof triggerGetRect === 'function') return triggerGetRect() || null
  }

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

  let pickerToggleSeq = 0

  async function toggleComposerPicker(kind: PickerKind) {
    const seq = ++pickerToggleSeq
    if (composerPickerOpen.value === kind) {
      composerPickerOpen.value = null
      return
    }

    onOpenComposerPicker()
    commandOpen.value = false
    commandQuery.value = ''
    commandIndex.value = 0

    if (composerPickerOpen.value) {
      composerPickerOpen.value = null
    }

    await nextTick()
    if (seq !== pickerToggleSeq) return

    composerPickerOpen.value = kind

    await nextTick()
    if (seq !== pickerToggleSeq) return

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
