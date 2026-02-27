<script setup lang="ts">
import { useToastsStore } from '../stores/toasts'
import { onMounted } from 'vue'
import Sonner from './ui/Sonner.vue'

const store = useToastsStore()

onMounted(() => {
  store.markHostReady()
})
</script>

<template>
  <Sonner class="oc-toaster" />
</template>
