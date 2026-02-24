<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'
import { useI18n } from 'vue-i18n'

type PendingRemoteAction = 'fetch' | 'pull' | 'push'

type ToastKind = 'info' | 'success' | 'error'
type Toasts = { push: (kind: ToastKind, message: string, timeoutMs?: number) => void }

const props = defineProps<{
  repoRoot: string | null
  toasts: Toasts
  authHelpText: string
  githubRemote: boolean
  commitMessage: string
  committing: boolean

  gitBusyTitle: string
  gitBusyExplain: string

  terminalHelpTitle: string
  terminalHelpExplain: string
  terminalHelpSend: string

  gpgExplain: string

  gpgEnableExplain: string
  gpgEnableBusy: boolean

  gpgMissingExplain: string
  gpgMissingBusy: boolean

  retryGitSso: () => void | Promise<void>
  dismissGitSsoDialog: () => void

  saveGithubTokenForRepo: () => void
  openGitTerminalWithCommand: (repoDir: string, gitCmd: string) => void
  terminalCommandForRemoteAction: (action: PendingRemoteAction) => string
  terminalCommandForCommit: (message: string) => string
  submitCredentials: () => void
  dismissGitBusyDialog: () => void
  retryGitBusy: () => void | Promise<void>
  submitGpgPassphrase: () => void
  enableGpgPresetAndRetry: () => void
  setRepoSigningKey: () => void
  disableRepoGpgSigning: () => void
}>()

const { t } = useI18n()

const credDialogOpen = defineModel<boolean>('credDialogOpen', { required: true })
const credAction = defineModel<PendingRemoteAction | null>('credAction', { required: true })
const credUsername = defineModel<string>('credUsername', { required: true })
const credPassword = defineModel<string>('credPassword', { required: true })
const credExplain = defineModel<string>('credExplain', { required: true })

const githubToken = defineModel<string>('githubToken', { required: true })
const githubTokenRemember = defineModel<boolean>('githubTokenRemember', { required: true })

const gitBusyDialogOpen = defineModel<boolean>('gitBusyDialogOpen', { required: true })

const ssoDialogOpen = defineModel<boolean>('ssoDialogOpen', { required: true })
const ssoAction = defineModel<PendingRemoteAction | null>('ssoAction', { required: true })
const ssoExplain = defineModel<string>('ssoExplain', { required: true })

const terminalHelpOpen = defineModel<boolean>('terminalHelpOpen', { required: true })

const gpgDialogOpen = defineModel<boolean>('gpgDialogOpen', { required: true })
const gpgPassphrase = defineModel<string>('gpgPassphrase', { required: true })
const pendingCommitMessage = defineModel<string>('pendingCommitMessage', { required: true })

const gpgEnableDialogOpen = defineModel<boolean>('gpgEnableDialogOpen', { required: true })

const gpgMissingDialogOpen = defineModel<boolean>('gpgMissingDialogOpen', { required: true })
const gpgSigningKeyInput = defineModel<string>('gpgSigningKeyInput', { required: true })

function repoDirOrEmpty(): string {
  return (props.repoRoot || '').trim()
}
</script>

<template>
  <!-- Git Credentials Dialog (HTTPS Basic / token) -->
  <FormDialog
    :open="credDialogOpen"
    :title="t('git.authDialogs.credentials.title')"
    :description="t('git.authDialogs.credentials.description')"
    maxWidth="max-w-md"
    @update:open="
      (v: boolean) => {
        credDialogOpen = v
        if (!v) credAction = null
      }
    "
  >
    <div class="space-y-4">
      <div
        v-if="credExplain"
        class="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground whitespace-pre-wrap"
      >
        {{ credExplain }}
      </div>

      <div class="rounded-md border border-border/60 bg-muted/10 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
        {{ authHelpText }}
      </div>

      <div v-if="githubRemote" class="rounded-md border border-border/60 bg-muted/10 p-3 text-xs text-muted-foreground">
        <div class="font-medium text-foreground/80">{{ t('git.authDialogs.credentials.githubTokenOptionalTitle') }}</div>
        <div class="mt-1">{{ t('git.authDialogs.credentials.githubTokenOptionalDescription') }}</div>
        <div class="mt-2 flex gap-2">
          <Input v-model="githubToken" class="h-9 font-mono text-xs" placeholder="ghp_..." />
        </div>
        <label class="mt-2 inline-flex items-center gap-2 select-none">
          <input v-model="githubTokenRemember" type="checkbox" class="accent-primary" />
          <span>{{ t('git.authDialogs.credentials.rememberForRepo') }}</span>
        </label>
        <div class="mt-2 flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            @click="
              () => {
                githubToken = ''
                props.saveGithubTokenForRepo()
              }
            "
            >{{ t('common.clear') }}</Button
          >
          <Button
            size="sm"
            @click="
              () => {
                props.saveGithubTokenForRepo()
                props.toasts.push('success', t('git.toasts.tokenSaved'))
              }
            "
            >{{ t('common.save') }}</Button
          >
        </div>
      </div>

      <div class="grid gap-3">
        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">{{ t('git.authDialogs.credentials.username') }}</div>
          <Input v-model="credUsername" class="h-9 font-mono text-xs" placeholder="x-access-token" />
        </div>
        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">{{ t('git.authDialogs.credentials.passwordOrToken') }}</div>
          <Input v-model="credPassword" type="password" class="h-9 font-mono text-xs" placeholder="••••••••" />
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          @click="
            () => {
              credDialogOpen = false
              credAction = null
            }
          "
          >{{ t('common.cancel') }}</Button
        >
        <Button
          variant="secondary"
          size="sm"
          @click="
            () => {
              props.openGitTerminalWithCommand(
                repoDirOrEmpty(),
                props.terminalCommandForRemoteAction(credAction || 'fetch'),
              )
              credDialogOpen = false
              credAction = null
            }
          "
        >
          Use Terminal
        </Button>
        <Button size="sm" :disabled="!credUsername.trim() || !credPassword.trim()" @click="props.submitCredentials"
          >{{ t('common.continue') }}</Button
        >
      </div>
    </div>
  </FormDialog>

  <!-- Git busy / operation in progress -->
  <FormDialog
    :open="gitBusyDialogOpen"
    :title="gitBusyTitle"
    :description="t('git.authDialogs.gitBusy.description')"
    maxWidth="max-w-md"
    @update:open="
      (v: boolean) => {
        if (v) {
          gitBusyDialogOpen = true
        } else {
          props.dismissGitBusyDialog()
        }
      }
    "
  >
    <div class="space-y-3">
      <div
        v-if="gitBusyExplain"
        class="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground whitespace-pre-wrap"
      >
        {{ gitBusyExplain }}
      </div>
      <div class="flex justify-end gap-2">
        <Button variant="secondary" size="sm" @click="props.dismissGitBusyDialog">{{ t('common.close') }}</Button>
        <Button size="sm" @click="props.retryGitBusy">{{ t('common.retry') }}</Button>
      </div>
    </div>
  </FormDialog>

  <!-- SSO authorization required -->
  <FormDialog
    :open="ssoDialogOpen"
    :title="t('git.authDialogs.sso.title')"
    :description="t('git.authDialogs.sso.description')"
    maxWidth="max-w-md"
    @update:open="
      (v: boolean) => {
        if (v) {
          ssoDialogOpen = true
        } else {
          props.dismissGitSsoDialog()
        }
      }
    "
  >
    <div class="space-y-3">
      <div
        v-if="ssoExplain"
        class="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground whitespace-pre-wrap"
      >
        {{ ssoExplain }}
      </div>
      <div class="rounded-md border border-border/60 bg-muted/10 p-3 text-[11px] text-muted-foreground">
        Complete the SSO authorization in your browser, then retry the operation.
      </div>
      <div
        class="rounded-md border border-border/60 bg-muted/10 p-3 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap"
      >
        {{ props.terminalCommandForRemoteAction(ssoAction || 'fetch') }}
      </div>
      <div class="flex justify-end gap-2">
        <Button variant="secondary" size="sm" @click="props.dismissGitSsoDialog">{{ t('common.close') }}</Button>
        <Button
          variant="secondary"
          size="sm"
          @click="
            () => {
              props.openGitTerminalWithCommand(
                repoDirOrEmpty(),
                props.terminalCommandForRemoteAction(ssoAction || 'fetch'),
              )
              props.dismissGitSsoDialog()
            }
          "
        >
          Use Terminal
        </Button>
        <Button size="sm" @click="props.retryGitSso">{{ t('common.retry') }}</Button>
      </div>
    </div>
  </FormDialog>

  <!-- Terminal Escape Hatch Dialog -->
  <FormDialog
    :open="terminalHelpOpen"
    :title="terminalHelpTitle"
    :description="t('git.authDialogs.terminalHelp.description')"
    maxWidth="max-w-md"
    @update:open="
      (v: boolean) => {
        terminalHelpOpen = v
      }
    "
  >
    <div class="space-y-3">
      <div
        v-if="terminalHelpExplain"
        class="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground whitespace-pre-wrap"
      >
        {{ terminalHelpExplain }}
      </div>

      <div
        class="rounded-md border border-border/60 bg-muted/10 p-3 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap"
      >
        {{ terminalHelpSend }}
      </div>

      <div class="flex justify-end gap-2">
        <Button variant="secondary" size="sm" @click="terminalHelpOpen = false">{{ t('common.cancel') }}</Button>
        <Button
          size="sm"
          @click="
            () => {
              props.openGitTerminalWithCommand(repoDirOrEmpty(), terminalHelpSend)
              terminalHelpOpen = false
            }
          "
        >
          {{ t('common.openTerminal') }}
        </Button>
      </div>
    </div>
  </FormDialog>

  <!-- GPG Passphrase Dialog -->
  <FormDialog
    :open="gpgDialogOpen"
    :title="t('git.authDialogs.gpgPassphrase.title')"
    :description="t('git.authDialogs.gpgPassphrase.description')"
    maxWidth="max-w-md"
    @update:open="
      (v: boolean) => {
        gpgDialogOpen = v
      }
    "
  >
    <div class="space-y-4">
      <div
        v-if="gpgExplain"
        class="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground whitespace-pre-wrap"
      >
        {{ gpgExplain }}
      </div>
      <div class="grid gap-1">
        <div class="text-xs font-medium text-muted-foreground">{{ t('git.authDialogs.gpgPassphrase.passphraseLabel') }}</div>
        <Input v-model="gpgPassphrase" type="password" class="h-9 font-mono text-xs" placeholder="••••••••" />
      </div>
      <div class="flex justify-end gap-2">
        <Button variant="secondary" size="sm" @click="gpgDialogOpen = false">{{ t('common.cancel') }}</Button>
        <Button
          variant="secondary"
          size="sm"
          @click="
            () => {
              props.openGitTerminalWithCommand(
                repoDirOrEmpty(),
                props.terminalCommandForCommit((pendingCommitMessage || commitMessage).trim()),
              )
              gpgDialogOpen = false
            }
          "
        >
          {{ t('common.useTerminal') }}
        </Button>
        <Button size="sm" :disabled="!gpgPassphrase.trim() || committing" @click="props.submitGpgPassphrase"
          >{{ t('git.authDialogs.gpgPassphrase.signAndCommit') }}</Button
        >
      </div>
    </div>
  </FormDialog>

  <!-- Confirm enabling gpg-agent preset passphrase -->
  <ConfirmPopover
    :open="gpgEnableDialogOpen"
    force-dialog
    :title="t('git.authDialogs.gpgEnablePreset.title')"
    :description="t('git.authDialogs.gpgEnablePreset.description')"
    :confirm-text="t('git.authDialogs.gpgEnablePreset.confirmEnableRetry')"
    cancel-text="Cancel"
    :busy="gpgEnableBusy"
    :confirm-disabled="gpgEnableBusy"
    :cancel-disabled="gpgEnableBusy"
    :close-on-confirm="false"
    max-width="max-w-md"
    @update:open="
      (v: boolean) => {
        gpgEnableDialogOpen = v
      }
    "
    @cancel="gpgEnableDialogOpen = false"
    @confirm="props.enableGpgPresetAndRetry"
  >
    <template #content>
      <div class="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
        {{ t('git.authDialogs.gpgEnablePreset.body') }}
      </div>

      <div
        v-if="gpgEnableExplain"
        class="rounded-md border border-border/60 bg-muted/10 p-3 text-xs text-muted-foreground whitespace-pre-wrap"
      >
        {{ gpgEnableExplain }}
      </div>
    </template>
  </ConfirmPopover>

  <!-- GPG missing key dialog -->
  <FormDialog
    :open="gpgMissingDialogOpen"
    :title="t('git.authDialogs.gpgMissingKey.title')"
    :description="t('git.authDialogs.gpgMissingKey.description')"
    maxWidth="max-w-md"
    @update:open="
      (v: boolean) => {
        gpgMissingDialogOpen = v
      }
    "
  >
    <div class="space-y-4">
      <div class="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
        {{ gpgMissingExplain || t('git.authDialogs.gpgMissingKey.defaultExplain') }}
      </div>

      <div class="space-y-2">
        <div class="text-xs font-medium text-muted-foreground">{{ t('git.authDialogs.gpgMissingKey.setSigningKeyLocal') }}</div>
        <Input
          v-model="gpgSigningKeyInput"
          class="h-9 font-mono text-xs"
          :placeholder="t('git.authDialogs.gpgMissingKey.placeholderKeyIdOrFingerprint')"
        />
        <div class="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            :disabled="gpgMissingBusy || !gpgSigningKeyInput.trim()"
            @click="props.setRepoSigningKey"
          >
            {{ t('git.authDialogs.gpgMissingKey.setSigningKeyButton') }}
          </Button>
        </div>
      </div>

      <div class="flex justify-between gap-2">
        <Button variant="destructive" size="sm" :disabled="gpgMissingBusy" @click="props.disableRepoGpgSigning">
          {{ t('git.authDialogs.gpgMissingKey.disableSigningButton') }}
        </Button>
        <Button variant="secondary" size="sm" @click="gpgMissingDialogOpen = false" :disabled="gpgMissingBusy"
          >{{ t('common.close') }}</Button
        >
      </div>
    </div>
  </FormDialog>
</template>
