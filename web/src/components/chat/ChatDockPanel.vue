<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RiArrowLeftSLine, RiPlayListAddLine } from '@remixicon/vue'

import ChatSidebar from '@/layout/ChatSidebar.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { useChatStore } from '@/stores/chat'
import { useUiStore } from '@/stores/ui'

const ChatPage = defineAsyncComponent(() => import('@/pages/ChatPage.vue'))

const ui = useUiStore()
const chat = useChatStore()
const { t } = useI18n()

const sessionSwitcherLabel = computed(() =>
  ui.isSessionSwitcherOpen ? String(t('nav.back')) : String(t('header.openSessions')),
)

function toggleSessionSwitcher() {
  ui.setSessionSwitcherOpen(!ui.isSessionSwitcherOpen)
}

watch(
  () => chat.selectedSessionId,
  (next, prev) => {
    if (!ui.isSessionSwitcherOpen) return
    if (!next || next === prev) return
    ui.setSessionSwitcherOpen(false)
  },
)

async function refresh() {
  await chat.refreshSessions().catch(() => {})
  const sid = String(chat.selectedSessionId || '').trim()
  if (!sid) return
  await chat.refreshMessages(sid, { silent: true }).catch(() => {})
}

defineExpose<{ refresh: () => Promise<void> }>({ refresh })

onMounted(() => {
  if (!chat.selectedSessionId) {
    ui.setSessionSwitcherOpen(true)
  }
})

onBeforeUnmount(() => {
  ui.setSessionSwitcherOpen(false)
})
</script>

<template>
  <section class="flex h-full min-h-0 flex-col overflow-hidden bg-background">
    <div class="border-b border-border/60 px-2 py-1.5">
      <IconButton
        size="sm"
        :tooltip="sessionSwitcherLabel"
        :aria-label="sessionSwitcherLabel"
        :is-touch-pointer="ui.isTouchPointer"
        @click="toggleSessionSwitcher"
      >
        <component :is="ui.isSessionSwitcherOpen ? RiArrowLeftSLine : RiPlayListAddLine" class="h-4 w-4" />
      </IconButton>
    </div>

    <div class="min-h-0 flex-1 overflow-hidden">
      <div v-show="ui.isSessionSwitcherOpen" class="h-full">
        <ChatSidebar mobile-variant :navigate-to-chat="false" />
      </div>

      <div v-show="!ui.isSessionSwitcherOpen" class="h-full">
        <ChatPage />
      </div>
    </div>
  </section>
</template>
