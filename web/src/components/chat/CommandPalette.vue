<script setup lang="ts">
import { ref, type Component } from 'vue'
import { RiRefreshLine } from '@remixicon/vue'
import ListRowButton from '@/components/ui/ListRowButton.vue'

// Intentionally UI-only; ChatPage keeps state + keyboard navigation.

type CommandItem = {
  name: string
  isBuiltIn?: boolean
  scope?: string
  agent?: string
  description?: string
  aliases?: string[]
}

const props = defineProps<{
  open: boolean
  loading: boolean
  commands: CommandItem[]
  activeIndex: number
  commandIcon: (cmd: CommandItem) => Component
}>()

const emit = defineEmits<{
  (e: 'update:activeIndex', value: number): void
  (e: 'select', cmd: CommandItem): void
}>()

const rootEl = ref<HTMLDivElement | null>(null)

function containsTarget(target: Node | null): boolean {
  if (!target) return false
  return Boolean(rootEl.value && rootEl.value.contains(target))
}

defineExpose({ rootEl, containsTarget })

function setIndex(i: number) {
  emit('update:activeIndex', i)
}
</script>

<template>
  <div
    v-if="open"
    ref="rootEl"
    class="absolute bottom-full mb-2 left-0 w-full max-w-[520px] rounded-xl border border-border bg-background/95 shadow-lg z-20"
  >
    <div class="max-h-64 overflow-auto px-2 py-2">
      <div v-if="loading" class="flex items-center justify-center py-4 text-muted-foreground">
        <RiRefreshLine class="h-4 w-4 animate-spin" />
      </div>
      <div v-else-if="commands.length === 0" class="px-3 py-2 text-sm text-muted-foreground">No commands found</div>
      <div v-else class="space-y-1">
        <ListRowButton
          v-for="(cmd, idx) in commands"
          :key="cmd.name"
          :active="idx === activeIndex"
          size="sm"
          @click="$emit('select', cmd)"
          @mouseenter="setIndex(idx)"
        >
          <component :is="commandIcon(cmd)" class="h-4 w-4 text-muted-foreground mt-0.5" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="font-mono text-sm">/{{ cmd.name }}</span>
              <span
                v-if="cmd.isBuiltIn"
                class="text-[10px] uppercase font-bold tracking-tight rounded border border-amber-300/40 bg-amber-200/10 text-amber-600 px-1.5 py-0.5"
              >
                system
              </span>
              <span
                v-else-if="cmd.scope"
                class="text-[10px] uppercase font-bold tracking-tight rounded border border-emerald-300/40 bg-emerald-200/10 text-emerald-600 px-1.5 py-0.5"
              >
                {{ cmd.scope }}
              </span>
              <span
                v-if="cmd.agent"
                class="text-[10px] font-bold tracking-tight rounded border border-border/60 bg-secondary/40 text-muted-foreground px-1.5 py-0.5"
              >
                {{ cmd.agent }}
              </span>
            </div>
            <div v-if="cmd.description" class="text-xs text-muted-foreground truncate">{{ cmd.description }}</div>
            <div v-if="cmd.aliases?.length" class="text-xs text-muted-foreground truncate">
              Aliases: /{{ cmd.aliases.join(' /') }}
            </div>
            <div v-if="!cmd.description && !cmd.aliases?.length" class="text-xs text-muted-foreground truncate">
              /{{ cmd.name }}
            </div>
          </div>
        </ListRowButton>
      </div>
    </div>
    <div class="px-3 py-1.5 border-t border-border/60 text-[11px] text-muted-foreground">
      Up/Down navigate | Enter select | Esc close
    </div>
  </div>
</template>
