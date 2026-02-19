<script setup lang="ts">
import { computed, type Component } from 'vue'
import {
  RiAddLine,
  RiAiGenerate2,
  RiBrain2Line,
  RiCloseCircleLine,
  RiFileTextLine,
  RiFolder6Line,
  RiGitMergeLine,
  RiLayoutLeftLine,
  RiRestartLine,
  RiMoonLine,
  RiPaletteLine,
  RiQuestionLine,
  RiSettings3Line,
  RiSunLine,
  RiTerminalBoxLine,
  RiTimeLine,
  RiText,
} from '@remixicon/vue'

import Dialog from '@/components/ui/Dialog.vue'
import { reloadOpenCodeConfig } from '@/lib/reload'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'

function getModifierLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl'
  return /Macintosh|Mac OS X/.test(navigator.userAgent || '') ? 'Cmd' : 'Ctrl'
}

const ui = useUiStore()
const settings = useSettingsStore()

const mod = computed(() => getModifierLabel())

type ShortcutItem = { keys: string; description: string; icon?: Component }

const sections = computed((): Array<{ category: string; items: ShortcutItem[] }> => {
  const m = mod.value
  return [
    {
      category: 'Navigation & Commands',
      items: [
        { keys: `${m}+.`, description: 'Show Keyboard Shortcuts', icon: RiQuestionLine },
        { keys: `${m}+L`, description: 'Toggle Session Sidebar', icon: RiLayoutLeftLine },
        { keys: `Shift+${m}+M`, description: 'Open Model Selector', icon: RiAiGenerate2 },
        { keys: `Shift+${m}+T`, description: 'Cycle Thinking Variant', icon: RiBrain2Line },
      ],
    },
    {
      category: 'Session Management',
      items: [
        {
          keys: `${m}+N`,
          description: 'Create New Session',
          icon: RiAddLine,
        },
        { keys: `${m}+Enter`, description: 'Send Message' },
        { keys: `${m}+I`, description: 'Focus Chat Input', icon: RiText },
        { keys: `Esc Esc`, description: 'Abort active run (double press)', icon: RiCloseCircleLine },
      ],
    },
    {
      category: 'Interface',
      items: [
        { keys: `${m}+/`, description: 'Cycle Theme (Light → Dark → System)', icon: RiPaletteLine },
        { keys: `${m}+2`, description: 'Open Diff Panel', icon: RiFileTextLine },
        { keys: `${m}+3`, description: 'Open Files', icon: RiFolder6Line },
        { keys: `${m}+4`, description: 'Open Terminal', icon: RiTerminalBoxLine },
        { keys: `${m}+5`, description: 'Open Git Panel', icon: RiGitMergeLine },
        { keys: `${m}+T`, description: 'Open Timeline', icon: RiTimeLine },
        { keys: `${m}+,`, description: 'Open Settings', icon: RiSettings3Line },
      ],
    },
  ]
})

async function reloadConfiguration() {
  // Same behavior as the old Command Palette action.
  await reloadOpenCodeConfig().catch(() => {})
  window.location.reload()
}

async function setTheme(mode: 'light' | 'dark' | 'system') {
  if (mode === 'system') {
    await settings.save({ useSystemTheme: true }).catch(() => {})
  } else {
    await settings.save({ useSystemTheme: false, themeVariant: mode }).catch(() => {})
  }
}
</script>

<template>
  <Dialog
    :open="ui.isHelpDialogOpen"
    title="Help"
    description="Keyboard shortcuts and quick actions"
    max-width="max-w-2xl"
    @update:open="(v) => (ui.isHelpDialogOpen = v)"
  >
    <div class="max-h-[65vh] overflow-auto pr-1">
      <div class="space-y-4">
        <section>
          <div class="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground mb-2">Quick Actions</div>
          <div class="space-y-1">
            <button
              type="button"
              class="w-full flex items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-secondary/40 text-left"
              @click="reloadConfiguration"
            >
              <div class="flex items-center gap-2 min-w-0">
                <RiRestartLine class="h-4 w-4 text-muted-foreground" />
                <span class="typography-meta text-foreground/90 truncate">Reload OpenCode Configuration</span>
              </div>
              <kbd
                class="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono bg-muted rounded border border-border/30"
              >
                Action
              </kbd>
            </button>

            <button
              type="button"
              class="w-full flex items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-secondary/40 text-left"
              @click="setTheme('light')"
            >
              <div class="flex items-center gap-2 min-w-0">
                <RiSunLine class="h-4 w-4 text-muted-foreground" />
                <span class="typography-meta text-foreground/90 truncate">Theme: Light</span>
              </div>
              <kbd
                class="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono bg-muted rounded border border-border/30"
              >
                Action
              </kbd>
            </button>

            <button
              type="button"
              class="w-full flex items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-secondary/40 text-left"
              @click="setTheme('dark')"
            >
              <div class="flex items-center gap-2 min-w-0">
                <RiMoonLine class="h-4 w-4 text-muted-foreground" />
                <span class="typography-meta text-foreground/90 truncate">Theme: Dark</span>
              </div>
              <kbd
                class="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono bg-muted rounded border border-border/30"
              >
                Action
              </kbd>
            </button>

            <button
              type="button"
              class="w-full flex items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-secondary/40 text-left"
              @click="setTheme('system')"
            >
              <div class="flex items-center gap-2 min-w-0">
                <RiPaletteLine class="h-4 w-4 text-muted-foreground" />
                <span class="typography-meta text-foreground/90 truncate">Theme: System</span>
              </div>
              <kbd
                class="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono bg-muted rounded border border-border/30"
              >
                Action
              </kbd>
            </button>
          </div>
        </section>

        <section v-for="section in sections" :key="section.category">
          <div class="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground mb-2">
            {{ section.category }}
          </div>
          <div class="space-y-1">
            <div
              v-for="item in section.items"
              :key="item.keys + item.description"
              class="flex items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-secondary/40"
            >
              <div class="flex items-center gap-2 min-w-0">
                <component v-if="item.icon" :is="item.icon" class="h-4 w-4 text-muted-foreground" />
                <span class="typography-meta text-foreground/90 truncate">{{ item.description }}</span>
              </div>
              <kbd
                class="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono bg-muted rounded border border-border/30"
              >
                {{ item.keys }}
              </kbd>
            </div>
          </div>
        </section>
      </div>

    </div>
  </Dialog>
</template>
