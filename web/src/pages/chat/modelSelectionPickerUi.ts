import { nextTick, type Ref } from 'vue'

type PickerKind = 'agent' | 'model' | 'variant'

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function useModelSelectionPickerUi(opts: {
  composerControlsRef: Ref<HTMLDivElement | null>
  composerPickerOpen: Ref<null | PickerKind>
  composerPickerStyle: Ref<Record<string, string>>
  agentTriggerRef: Ref<HTMLElement | null>
  modelTriggerRef: Ref<HTMLElement | null>
  variantTriggerRef: Ref<HTMLElement | null>
  modelPickerQuery: Ref<string>
  agentPickerQuery: Ref<string>
  closeComposerActionMenu: () => void
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
    closeComposerActionMenu,
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

    closeComposerActionMenu()
    commandOpen.value = false
    commandQuery.value = ''
    commandIndex.value = 0
    composerPickerOpen.value = kind

    void nextTick(() => {
      const box = composerControlsRef.value
      const anchor =
        kind === 'agent' ? agentTriggerRef.value : kind === 'model' ? modelTriggerRef.value : variantTriggerRef.value
      if (!box || !anchor) {
        composerPickerStyle.value = { left: '8px' }
        return
      }

      const boxRect = box.getBoundingClientRect()
      const anchorRect = anchor.getBoundingClientRect()

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
