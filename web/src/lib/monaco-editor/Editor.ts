// Vendored from @guolao/vue-monaco-editor@1.6.0 (MIT).
import {
  computed,
  defineComponent,
  h,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
  type PropType,
  type SetupContext,
  type ShallowRef,
} from 'vue'
import type * as monacoEditor from 'monaco-editor'

import { type MonacoEditor, type Nullable } from './types'
import { useContainer } from './useContainer'
import { useMonaco } from './useMonaco'
import { getOrCreateModel, isUndefined, slotHelper } from './utils'

export interface EditorProps {
  defaultValue?: string
  defaultPath?: string
  defaultLanguage?: string
  value?: string
  language?: string
  path?: string

  theme: 'vs' | string
  line?: number
  options: monacoEditor.editor.IStandaloneEditorConstructionOptions
  overrideServices: monacoEditor.editor.IEditorOverrideServices
  saveViewState: boolean

  width: number | string
  height: number | string
  className?: string
}

export interface VueMonacoEditorEmitsOptions {
  'update:value': (value: string | undefined) => void
  beforeMount: (monaco: MonacoEditor) => void
  mount: (editor: monacoEditor.editor.IStandaloneCodeEditor, monaco: MonacoEditor) => void
  change: (value: string | undefined, event: monacoEditor.editor.IModelContentChangedEvent) => void
  validate: (markers: monacoEditor.editor.IMarker[]) => void
}

const loadingStyle = {
  display: 'flex',
  height: '100%',
  width: '100%',
  justifyContent: 'center',
  alignItems: 'center',
}

export default defineComponent({
  name: 'VueMonacoEditor',
  props: {
    defaultValue: String,
    defaultPath: String,
    defaultLanguage: String,
    value: String,
    language: String,
    path: String,
    theme: {
      type: String,
      default: 'vs',
    },
    line: Number,
    options: {
      type: Object as PropType<monacoEditor.editor.IStandaloneEditorConstructionOptions>,
      default: () => ({}),
    },
    overrideServices: {
      type: Object as PropType<monacoEditor.editor.IEditorOverrideServices>,
      default: () => ({}),
    },
    saveViewState: {
      type: Boolean,
      default: true,
    },
    width: {
      type: [Number, String] as PropType<number | string>,
      default: '100%',
    },
    height: {
      type: [Number, String] as PropType<number | string>,
      default: '100%',
    },
    className: String,
  },
  emits: ['update:value', 'beforeMount', 'mount', 'change', 'validate'],
  setup(props, ctx: SetupContext<VueMonacoEditorEmitsOptions>) {
    const viewStates = new Map<string | undefined, Nullable<monacoEditor.editor.ICodeEditorViewState>>()
    const containerRef = shallowRef<Nullable<HTMLElement>>(null)
    const { monacoRef, unload, isLoadFailed } = useMonaco()
    const { editorRef } = useEditor(ctx, props, monacoRef, containerRef)
    const { disposeValidator } = useValidator(ctx, monacoRef, editorRef)
    const isEditorReady = computed(() => !!monacoRef.value && !!editorRef.value)
    const { wrapperStyle, containerStyle } = useContainer(props, isEditorReady)

    onUnmounted(() => {
      disposeValidator.value?.()
      if (editorRef.value) {
        editorRef.value.getModel()?.dispose()
        editorRef.value.dispose()
      } else {
        unload()
      }
    })

    watch(
      [() => props.path, () => props.value, () => props.language, () => props.line],
      ([newPath, newValue, newLanguage, newLine], [oldPath, , oldLanguage, oldLine]) => {
        if (!isEditorReady.value || !editorRef.value || !monacoRef.value) {
          return
        }

        if (newPath !== oldPath) {
          const newModel = getOrCreateModel(
            monacoRef.value,
            newValue || props.defaultValue || '',
            newLanguage || props.defaultLanguage || '',
            newPath || props.defaultPath || '',
          )
          if (props.saveViewState) {
            viewStates.set(oldPath, editorRef.value.saveViewState())
          }
          editorRef.value.setModel(newModel)
          if (props.saveViewState) {
            editorRef.value.restoreViewState(viewStates.get(newPath) ?? null)
          }

          if (!isUndefined(newLine)) {
            editorRef.value.revealLine(newLine)
          }
          return
        }

        if (editorRef.value.getValue() !== newValue) {
          editorRef.value.setValue(newValue || '')
        }

        if (newLanguage !== oldLanguage) {
          monacoRef.value.editor.setModelLanguage(
            editorRef.value.getModel()!,
            newLanguage || props.defaultLanguage || 'plaintext',
          )
        }

        if (!isUndefined(newLine) && newLine !== oldLine) {
          editorRef.value.revealLine(newLine)
        }
      },
    )

    watch(
      () => props.options,
      (options) => {
        editorRef.value?.updateOptions(options)
      },
      { deep: true },
    )

    watch(
      () => props.theme,
      (theme) => {
        if (monacoRef.value) {
          monacoRef.value.editor.setTheme(theme)
        }
      },
    )

    return {
      containerRef,
      isEditorReady,
      isLoadFailed,
      wrapperStyle,
      containerStyle,
    }
  },
  render() {
    const { $slots, isEditorReady, isLoadFailed, wrapperStyle, containerStyle, className } = this

    return h(
      'div',
      {
        style: wrapperStyle,
      },
      [
        !isEditorReady &&
          h(
            'div',
            {
              style: loadingStyle,
            },
            isLoadFailed
              ? $slots.failure
                ? slotHelper($slots.failure)
                : 'load failed'
              : $slots.default
                ? slotHelper($slots.default)
                : 'loading...',
          ),
        h('div', {
          ref: 'containerRef',
          key: 'monaco_editor_container',
          style: containerStyle,
          class: className,
        }),
      ],
    )
  },
})

function useEditor(
  { emit }: SetupContext<VueMonacoEditorEmitsOptions>,
  props: EditorProps,
  monacoRef: ShallowRef<Nullable<MonacoEditor>>,
  containerRef: ShallowRef<Nullable<HTMLElement>>,
) {
  const editorRef = shallowRef<Nullable<monacoEditor.editor.IStandaloneCodeEditor>>(null)

  onMounted(() => {
    const stop = watch(
      monacoRef,
      () => {
        if (containerRef.value && monacoRef.value) {
          nextTick(() => stop())
          createEditor()
        }
      },
      { immediate: true },
    )
  })

  function createEditor() {
    if (!containerRef.value || !monacoRef.value || editorRef.value) {
      return
    }

    emit('beforeMount', monacoRef.value)

    const autoCreatedModelPath = props.path || props.defaultPath
    const defaultModel = getOrCreateModel(
      monacoRef.value,
      props.value || props.defaultValue || '',
      props.language || props.defaultLanguage || '',
      autoCreatedModelPath || '',
    )

    editorRef.value = monacoRef.value.editor.create(
      containerRef.value,
      {
        model: defaultModel,
        theme: props.theme,
        automaticLayout: true,
        autoIndent: 'brackets',
        formatOnPaste: true,
        formatOnType: true,
        ...props.options,
      },
      props.overrideServices,
    )

    editorRef.value.onDidChangeModelContent((event: monacoEditor.editor.IModelContentChangedEvent) => {
      const value = editorRef.value?.getValue()
      if (value !== props.value) {
        emit('update:value', value)
        emit('change', value, event)
      }
    })

    if (editorRef.value && !isUndefined(props.line)) {
      editorRef.value.revealLine(props.line)
    }

    emit('mount', editorRef.value, monacoRef.value)
  }

  return { editorRef }
}

function useValidator(
  { emit }: SetupContext<VueMonacoEditorEmitsOptions>,
  monacoRef: ShallowRef<Nullable<MonacoEditor>>,
  editorRef: ShallowRef<Nullable<monacoEditor.editor.IStandaloneCodeEditor>>,
) {
  const disposeValidator = ref<Nullable<() => void>>(null)

  const stop = watch([monacoRef, editorRef], () => {
    const monacoInstance = monacoRef.value
    const editorInstance = editorRef.value
    if (monacoInstance && editorInstance) {
      nextTick(() => stop())
      const changeMarkersListener = monacoInstance.editor.onDidChangeMarkers((uris: readonly monacoEditor.Uri[]) => {
        const editorUri = editorInstance.getModel()?.uri
        if (editorUri) {
          const currentEditorHasMarkerChanges = uris.find((uri: monacoEditor.Uri) => uri.path === editorUri.path)
          if (currentEditorHasMarkerChanges) {
            const markers = monacoInstance.editor.getModelMarkers({ resource: editorUri })
            emit('validate', markers)
          }
        }
      })

      disposeValidator.value = () => {
        changeMarkersListener.dispose()
      }
    }
  })

  return { disposeValidator }
}
