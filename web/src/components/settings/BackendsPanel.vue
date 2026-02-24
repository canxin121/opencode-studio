<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RiAddLine, RiDeleteBinLine, RiEditLine, RiRefreshLine, RiSettings3Line } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import { useBackendsStore } from '@/stores/backends'
import { useToastsStore } from '@/stores/toasts'
import Button from '@/components/ui/Button.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Input from '@/components/ui/Input.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'

type BackendDraft = {
  id: string | null
  label: string
  baseUrl: string
}

const backends = useBackendsStore()
const toasts = useToastsStore()
const { t } = useI18n()

const activeId = computed(() => backends.activeBackend?.id || null)
const activeBaseUrl = computed(() => backends.activeBackend?.baseUrl || '')

const addOpen = ref(false)
const addBusy = ref(false)
const addSetActive = ref(true)
const addDraft = ref<BackendDraft>({ id: null, label: '', baseUrl: '' })

const editOpen = ref(false)
const editBusy = ref(false)
const editOriginalBaseUrl = ref('')
const editDraft = ref<BackendDraft>({ id: null, label: '', baseUrl: '' })

function hardReload() {
  try {
    window.location.reload()
  } catch {
    // ignore
  }
}

function openAdd() {
  addDraft.value = { id: null, label: '', baseUrl: '' }
  addSetActive.value = true
  addOpen.value = true
}

async function submitAdd() {
  if (addBusy.value) return
  addBusy.value = true
  try {
    const result = backends.addBackend({
      label: addDraft.value.label,
      baseUrl: addDraft.value.baseUrl,
      setActive: addSetActive.value,
    })

    if (!result.ok) {
      toasts.push('error', result.error || t('settings.backendsPanel.toasts.failedToAdd'))
      return
    }

    addOpen.value = false
    toasts.push(
      'success',
      addSetActive.value
        ? t('settings.backendsPanel.toasts.addedAndActivated')
        : t('settings.backendsPanel.toasts.added'),
    )

    if (addSetActive.value) {
      hardReload()
    }
  } finally {
    addBusy.value = false
  }
}

function openEdit(id: string) {
  const backend = backends.backends.find((b) => b.id === id)
  if (!backend) return
  editDraft.value = { id: backend.id, label: backend.label, baseUrl: backend.baseUrl }
  editOriginalBaseUrl.value = backend.baseUrl
  editOpen.value = true
}

async function submitEdit() {
  if (editBusy.value) return
  const id = String(editDraft.value.id || '').trim()
  if (!id) return
  editBusy.value = true
  try {
    const result = backends.updateBackend({
      id,
      label: editDraft.value.label,
      baseUrl: editDraft.value.baseUrl,
    })
    if (!result.ok) {
      toasts.push('error', result.error || t('settings.backendsPanel.toasts.failedToUpdate'))
      return
    }

    editOpen.value = false
    toasts.push('success', t('settings.backendsPanel.toasts.updated'))

    const isActive = activeId.value === id
    const baseChanged = editOriginalBaseUrl.value && editOriginalBaseUrl.value !== editDraft.value.baseUrl
    if (isActive && baseChanged) {
      hardReload()
    }
  } finally {
    editBusy.value = false
  }
}

function activate(id: string) {
  const trimmed = String(id || '').trim()
  if (!trimmed || trimmed === activeId.value) return
  backends.setActiveBackend(trimmed)
  toasts.push('info', t('settings.backendsPanel.toasts.switching'))
  hardReload()
}

function remove(id: string) {
  const trimmed = String(id || '').trim()
  if (!trimmed) return
  const wasActive = trimmed === activeId.value
  const result = backends.removeBackend(trimmed)
  if (!result.ok) {
    toasts.push('error', result.error || t('settings.backendsPanel.toasts.failedToRemove'))
    return
  }
  toasts.push('success', t('settings.backendsPanel.toasts.removed'))
  if (wasActive) {
    toasts.push('info', t('common.reloading'))
    hardReload()
  }
}

watch(
  () => addOpen.value,
  (open) => {
    if (!open) {
      addBusy.value = false
    }
  },
)

watch(
  () => editOpen.value,
  (open) => {
    if (!open) {
      editBusy.value = false
      editOriginalBaseUrl.value = ''
    }
  },
)

function refreshFromStorage() {
  backends.hydrate()
  toasts.push('success', t('settings.backendsPanel.toasts.refreshed'))
}
</script>

<template>
  <div class="space-y-6">
    <div class="rounded-lg border border-border bg-muted/10 p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <RiSettings3Line class="h-4 w-4 text-muted-foreground" />
            <div class="text-sm font-medium">{{ t('settings.backendsPanel.title') }}</div>
          </div>
          <div class="mt-1 text-xs text-muted-foreground">
            {{ t('settings.backendsPanel.description') }}
          </div>
        </div>

        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" @click="openAdd">
            <RiAddLine class="h-4 w-4 mr-2" />
            {{ t('common.add') }}
          </Button>
          <IconButton
            size="sm"
            :title="t('common.refresh')"
            :aria-label="t('common.refresh')"
            @click="refreshFromStorage"
          >
            <RiRefreshLine class="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <div v-if="activeBaseUrl" class="mt-4 rounded-md border border-border/60 bg-background/60 p-3">
        <div class="text-xs text-muted-foreground">{{ t('settings.backendsPanel.activeBackend') }}</div>
        <div class="mt-1 text-sm font-medium break-words">
          {{ backends.activeBackend?.label || t('settings.backendsPanel.backendFallback') }}
        </div>
        <div class="mt-1 text-xs font-mono text-muted-foreground break-all">{{ activeBaseUrl }}</div>
      </div>
    </div>

    <div class="grid gap-3">
      <div v-for="b in backends.backends" :key="b.id" class="rounded-lg border border-border bg-background/60 p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <div class="text-sm font-semibold break-words">{{ b.label }}</div>
              <span
                v-if="b.id === activeId"
                class="inline-flex items-center rounded-full border border-border/70 bg-primary/10 px-2 py-0.5 text-[11px] font-medium"
              >
                {{ t('settings.backendsPanel.activeBadge') }}
              </span>
            </div>
            <div class="mt-1 text-xs font-mono text-muted-foreground break-all">{{ b.baseUrl }}</div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <Button v-if="b.id !== activeId" variant="outline" size="sm" @click="activate(b.id)">{{
              t('common.use')
            }}</Button>
            <IconButton size="sm" :title="t('common.edit')" :aria-label="t('common.edit')" @click="openEdit(b.id)">
              <RiEditLine class="h-4 w-4" />
            </IconButton>
            <ConfirmPopover
              :title="t('settings.backendsPanel.confirmRemove.title')"
              :description="b.baseUrl"
              :confirmText="t('common.remove')"
              :cancelText="t('common.cancel')"
              variant="destructive"
              :confirmDisabled="b.id === activeId && backends.backends.length <= 1"
              @confirm="remove(b.id)"
            >
              <IconButton size="sm" :title="t('common.remove')" :aria-label="t('common.remove')">
                <RiDeleteBinLine class="h-4 w-4 text-destructive" />
              </IconButton>
            </ConfirmPopover>
          </div>
        </div>
      </div>

      <div v-if="backends.backends.length === 0" class="rounded-lg border border-border bg-muted/10 p-4 text-sm">
        {{ t('settings.backendsPanel.noBackends') }}
      </div>
    </div>

    <!-- Add Dialog -->
    <FormDialog
      :open="addOpen"
      :title="t('settings.backendsPanel.dialogs.add.title')"
      :description="t('settings.backendsPanel.dialogs.add.description')"
      maxWidth="max-w-md"
      @update:open="(v) => (addOpen = v)"
    >
      <div class="grid gap-4">
        <div class="grid gap-2">
          <label class="text-sm font-medium">{{ t('settings.backendsPanel.dialogs.add.label') }}</label>
          <Input
            v-model="addDraft.label"
            :placeholder="t('settings.backendsPanel.dialogs.add.labelPlaceholder')"
            :disabled="addBusy"
            class="h-10"
          />
        </div>

        <div class="grid gap-2">
          <label class="text-sm font-medium">{{ t('settings.backendsPanel.dialogs.add.baseUrl') }}</label>
          <Input
            v-model="addDraft.baseUrl"
            :placeholder="t('settings.backendsPanel.dialogs.add.baseUrlPlaceholder')"
            :disabled="addBusy"
            class="h-10"
            autocomplete="url"
            inputmode="url"
          />
          <div class="text-xs text-muted-foreground">
            {{ t('settings.backendsPanel.dialogs.add.examples') }}
          </div>
        </div>

        <label class="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" v-model="addSetActive" :disabled="addBusy" />
          {{ t('settings.backendsPanel.dialogs.add.setActive') }}
        </label>

        <div class="flex items-center justify-end gap-2">
          <Button variant="secondary" :disabled="addBusy" @click="addOpen = false">{{ t('common.cancel') }}</Button>
          <Button :disabled="addBusy" @click="submitAdd">{{ addBusy ? t('common.saving') : t('common.add') }}</Button>
        </div>
      </div>
    </FormDialog>

    <!-- Edit Dialog -->
    <FormDialog
      :open="editOpen"
      :title="t('settings.backendsPanel.dialogs.edit.title')"
      :description="t('settings.backendsPanel.dialogs.edit.description')"
      maxWidth="max-w-md"
      @update:open="(v) => (editOpen = v)"
    >
      <div class="grid gap-4">
        <div class="grid gap-2">
          <label class="text-sm font-medium">{{ t('settings.backendsPanel.dialogs.edit.label') }}</label>
          <Input
            v-model="editDraft.label"
            :placeholder="t('settings.backendsPanel.backendFallback')"
            :disabled="editBusy"
            class="h-10"
          />
        </div>

        <div class="grid gap-2">
          <label class="text-sm font-medium">{{ t('settings.backendsPanel.dialogs.edit.baseUrl') }}</label>
          <Input
            v-model="editDraft.baseUrl"
            placeholder="https://studio.example.com"
            :disabled="editBusy"
            class="h-10"
            autocomplete="url"
            inputmode="url"
          />
        </div>

        <div class="flex items-center justify-end gap-2">
          <Button variant="secondary" :disabled="editBusy" @click="editOpen = false">{{ t('common.cancel') }}</Button>
          <Button :disabled="editBusy" @click="submitEdit">{{
            editBusy ? t('common.saving') : t('common.save')
          }}</Button>
        </div>
      </div>
    </FormDialog>
  </div>
</template>
