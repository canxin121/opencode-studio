// Vendored from @guolao/vue-monaco-editor@1.6.0 (MIT).
import { computed, type Ref } from 'vue'

type ContainerProps = {
  width: number | string
  height: number | string
}

const styles = {
  wrapper: {
    display: 'flex',
    position: 'relative',
    textAlign: 'initial',
  },
  fullWidth: {
    width: '100%',
  },
  hide: {
    display: 'none',
  },
}

export function useContainer(props: ContainerProps, isEditorReady: Ref<boolean>) {
  const wrapperStyle = computed(() => {
    const { width, height } = props
    return {
      ...styles.wrapper,
      width,
      height,
    }
  })

  const containerStyle = computed(() => {
    return {
      ...styles.fullWidth,
      ...(!isEditorReady.value && styles.hide),
    }
  })

  return { wrapperStyle, containerStyle }
}
