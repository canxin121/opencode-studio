<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import Skeleton from '@/components/ui/Skeleton.vue'
import { invokeHostPluginAction, subscribeHostPluginEvents } from '@/plugins/host/sdk'
import { pluginAssetEntryUrl, type ChatMount } from '@/plugins/host/mounts'
import type { JsonValue as JsonLike } from '@/types/json'

type MountContext = Record<string, string>

type MountHostApi = {
  invokeAction: (action: string, payload?: JsonLike, context?: JsonLike) => Promise<JsonLike>
  subscribeEvents: (handlers: {
    onEvent?: (evt: { type: string; data: JsonLike; lastEventId?: string }) => void
    onError?: (err: Event) => void
  }) => () => void
}

type MountLayoutApi = {
  // For overlay-style mounts: reserve pixels in the host message list.
  setReservePx: (px: number) => void
}

type PluginUiModule = {
  mount?: (
    el: HTMLElement,
    opts: {
      pluginId: string
      surface: string
      title?: string
      context: MountContext
      host: MountHostApi
      layout?: MountLayoutApi
      close?: () => void
    },
  ) => unknown
  default?: unknown
}

const props = withDefaults(
  defineProps<{
    mount: ChatMount
    fixedHeight?: number
  }>(),
  {
    fixedHeight: 0,
  },
)

const emit = defineEmits<{
  (e: 'reserve-change', px: number): void
  (e: 'request-close'): void
}>()

const { t } = useI18n()

const moduleRootEl = ref<HTMLElement | null>(null)

const loaded = ref(false)
const loadError = ref<string | null>(null)

let cleanupMountedUi: (() => void) | null = null

function safeContext(): MountContext {
  const raw = props.mount.context
  if (!raw || typeof raw !== 'object') return {}
  const out: MountContext = {}
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k || '').trim()
    const val = String(v || '').trim()
    if (!key || !val) continue
    out[key] = val
  }
  return out
}

const mountMode = computed(() => props.mount.mode || 'iframe')

const entryAssetUrl = computed(() => pluginAssetEntryUrl(props.mount.pluginId, props.mount.entry))

const iframeSrc = computed(() => {
  if (typeof window === 'undefined') return entryAssetUrl.value

  const url = new URL(entryAssetUrl.value, window.location.origin)
  const ctx = safeContext()
  for (const [key, value] of Object.entries(ctx)) {
    url.searchParams.set(key, value)
  }
  url.searchParams.set('surface', props.mount.surface)
  url.searchParams.set('pluginId', props.mount.pluginId)
  if (props.mount.pluginVersion) {
    url.searchParams.set('pluginVersion', props.mount.pluginVersion)
  }
  return url.toString()
})

function clearReserve() {
  emit('reserve-change', 0)
}

function setReservePx(px: number) {
  const next = Number.isFinite(px) && px > 0 ? Math.max(0, Math.floor(px)) : 0
  emit('reserve-change', next)
}

function cleanup() {
  cleanupMountedUi?.()
  cleanupMountedUi = null
  clearReserve()
  const el = moduleRootEl.value
  if (el) {
    // Ensure no stale DOM remains even if plugin forgets to clean up.
    el.innerHTML = ''
  }
}

function resolveModuleMountFn(mod: PluginUiModule): PluginUiModule['mount'] {
  if (typeof mod.mount === 'function') return mod.mount
  const def = mod.default
  if (typeof def === 'function') {
    // Allow default export to be the mount function.
    return def as PluginUiModule['mount']
  }
  if (def && typeof def === 'object' && typeof (def as any).mount === 'function') {
    return (def as any).mount as PluginUiModule['mount']
  }
  return undefined
}

async function ensureModuleMounted() {
  cleanup()
  loaded.value = false
  loadError.value = null

  const hostEl = moduleRootEl.value
  if (!hostEl) return

  // Cache bust module loads by version when present.
  const cacheKey = String(props.mount.pluginVersion || '').trim()
  const importUrl = cacheKey ? `${entryAssetUrl.value}?v=${encodeURIComponent(cacheKey)}` : entryAssetUrl.value

  try {
    const mod = (await import(/* @vite-ignore */ importUrl)) as PluginUiModule
    const mountFn = resolveModuleMountFn(mod)
    if (!mountFn) {
      throw new Error('Plugin UI module must export mount(el, opts)')
    }

    const ctx = safeContext()
    const host: MountHostApi = {
      invokeAction: async (action, payload = null, context = null) => {
        return await invokeHostPluginAction(
          props.mount.pluginId,
          action,
          payload ?? null,
          context ?? (ctx as unknown as JsonLike),
        )
      },
      subscribeEvents: (handlers) => subscribeHostPluginEvents(props.mount.pluginId, handlers),
    }

    const layout: MountLayoutApi = {
      setReservePx,
    }

    const result = mountFn(hostEl, {
      pluginId: props.mount.pluginId,
      surface: props.mount.surface,
      title: props.mount.title,
      context: ctx,
      host,
      layout,
      close: () => emit('request-close'),
    })

    if (typeof result === 'function') {
      cleanupMountedUi = result as () => void
    } else if (result && typeof result === 'object' && typeof (result as any).unmount === 'function') {
      cleanupMountedUi = () => {
        try {
          ;(result as any).unmount()
        } catch {
          // ignore
        }
      }
    }

    loaded.value = true
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
    loaded.value = true
  }
}

watch(
  () => {
    const ctx = safeContext()
    return {
      mode: mountMode.value,
      pluginId: props.mount.pluginId,
      entry: props.mount.entry,
      surface: props.mount.surface,
      // Treat context changes as a remount signal.
      contextKey: JSON.stringify(ctx),
      pluginVersion: props.mount.pluginVersion || '',
      // For module mounts the host element ref is assigned after the first render.
      // Include this in the watch key so we retry mounting once the ref is ready.
      moduleHostReady: mountMode.value === 'module' ? Boolean(moduleRootEl.value) : true,
    }
  },
  async (next) => {
    cleanup()
    loaded.value = false
    loadError.value = null

    if (next.mode === 'module') {
      if (!moduleRootEl.value) {
        // Keep the loading mask visible until the module mount target exists.
        return
      }
      await ensureModuleMounted()
      return
    }

    // iframe mode: reserve is handled by the host (if needed) via explicit APIs.
    // Default to no reserve.
    clearReserve()
  },
  { immediate: true, flush: 'post' },
)

onBeforeUnmount(() => {
  cleanup()
})

const fixedHeight = computed(() => {
  const raw = Number(props.fixedHeight || 0)
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return Math.max(80, Math.floor(raw))
})

const containerStyle = computed(() => {
  if (fixedHeight.value <= 0) return undefined
  return { height: `${fixedHeight.value}px` }
})

const iframeStyle = computed(() => {
  if (fixedHeight.value > 0) return undefined
  // If no fixed height, let iframe size itself. Most plugin UIs should use a fixed
  // height mount; overlay mounts typically use module mode.
  return { height: '260px' }
})

function onIframeLoad() {
  loaded.value = true
  loadError.value = null
}

function onIframeError() {
  loaded.value = true
  loadError.value = String(t('plugins.mountHost.errors.iframeLoadFailed'))
}
</script>

<template>
  <div class="relative w-full" :style="containerStyle" :aria-busy="!loaded">
    <template v-if="mountMode === 'iframe'">
      <iframe
        class="w-full bg-background"
        :class="fixedHeight > 0 ? 'h-full' : ''"
        :style="iframeStyle"
        :src="iframeSrc"
        :title="mount.title"
        loading="lazy"
        @load="onIframeLoad"
        @error="onIframeError"
      />
    </template>

    <template v-else>
      <div ref="moduleRootEl" class="w-full" :class="fixedHeight > 0 ? 'h-full overflow-auto' : ''" />
    </template>

    <div
      v-if="!loaded"
      class="absolute inset-0 bg-background/85 backdrop-blur-sm"
      role="status"
      :aria-label="t('plugins.mountHost.loadingAria')"
    >
      <div class="h-full w-full flex items-center justify-center p-3">
        <div class="w-full max-w-md">
          <div class="rounded-xl border border-border/60 bg-muted/10 p-3">
            <div class="flex items-center gap-3">
              <Skeleton class="h-3 w-28" />
              <Skeleton class="h-3 w-16" />
              <div class="ml-auto flex items-center gap-2">
                <Skeleton class="h-7 w-7 rounded-md" />
                <Skeleton class="h-7 w-7 rounded-md" />
              </div>
            </div>

            <div class="mt-3 grid gap-3">
              <Skeleton class="h-16 w-full rounded-lg" />
              <div class="grid grid-cols-2 gap-3">
                <Skeleton class="h-9 w-full" />
                <Skeleton class="h-9 w-full" />
              </div>
              <div class="space-y-2">
                <Skeleton class="h-2.5 w-[86%]" />
                <Skeleton class="h-2.5 w-[62%]" />
                <Skeleton class="h-2.5 w-[78%]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-else-if="loadError"
      class="absolute inset-0 flex items-center justify-center px-3 text-xs text-destructive bg-background/85 break-words text-center"
    >
      {{ loadError }}
    </div>
  </div>
</template>
