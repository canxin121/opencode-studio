<script setup lang="ts">
import { useToastsStore } from '../stores/toasts'
import { onMounted } from 'vue'
import Sonner from './ui/Sonner.vue'

const store = useToastsStore()

const desktopToastOffset = {
  right: 'calc(var(--oc-safe-area-right, 0px) + 12px)',
  bottom: 'calc(var(--oc-safe-area-bottom, 0px) + 12px)',
}

const mobileToastOffset = {
  left: 'calc(var(--oc-safe-area-left, 0px) + 10px)',
  right: 'calc(var(--oc-safe-area-right, 0px) + 10px)',
  bottom:
    'calc(var(--oc-safe-area-bottom, 0px) + var(--oc-bottom-nav-height, 56px) - clamp(0px, var(--oc-keyboard-inset, 0px), var(--oc-bottom-nav-height, 56px)) + 10px)',
}

onMounted(() => {
  store.markHostReady()
})
</script>

<template>
  <Teleport to="body">
    <Sonner
      class="oc-toaster"
      position="bottom-right"
      :offset="desktopToastOffset"
      :mobile-offset="mobileToastOffset"
    />
  </Teleport>
</template>
