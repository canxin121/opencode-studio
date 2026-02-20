<script lang="ts">
import { defineComponent } from 'vue'
import { RiAddLine, RiArrowDownSLine, RiArrowUpSLine, RiCloseLine, RiRestartLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Tooltip from '@/components/ui/Tooltip.vue'
import VirtualList from '@/components/ui/VirtualList.vue'
import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Button,
    Input,
    Tooltip,
    VirtualList,
    CodeMirrorEditor,
    RiAddLine,
    RiArrowDownSLine,
    RiArrowUpSLine,
    RiCloseLine,
    RiRestartLine,
  },
  setup() {
    return useOpencodeConfigPanelContext()
  },
})
</script>

<template>
  <section id="instructions" class="scroll-mt-24 rounded-lg border border-border bg-background p-4 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-base font-semibold leading-snug">Instruction sources, skills, and plugins.</div>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip>
          <Button
            size="icon"
            variant="ghost"
            class="h-8 w-8"
            title="Reset section"
            @click="resetSection('instructions')"
          >
            <RiRestartLine class="h-4 w-4" />
          </Button>
          <template #content>Reset section</template>
        </Tooltip>
        <Tooltip>
          <Button
            size="icon"
            variant="outline"
            class="h-8 w-8"
            :title="isSectionOpen('instructions') ? 'Collapse' : 'Expand'"
            @click="toggleSection('instructions')"
          >
            <RiArrowUpSLine v-if="isSectionOpen('instructions')" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{ isSectionOpen('instructions') ? 'Collapse' : 'Expand' }}</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="isSectionOpen('instructions')" class="grid gap-4 lg:grid-cols-3">
      <div class="rounded-md border border-border p-3 space-y-2">
        <div class="flex items-center justify-between">
          <div class="text-sm font-semibold">Instructions</div>
          <div class="flex items-center gap-2">
            <Tooltip>
              <Button
                size="icon"
                variant="ghost"
                class="h-8 w-8"
                title="Clear"
                aria-label="Clear instructions"
                @click="instructionsArr = []"
              >
                <RiCloseLine class="h-4 w-4" />
              </Button>
              <template #content>Clear</template>
            </Tooltip>
          </div>
        </div>
        <div class="text-[11px] text-muted-foreground">Files/URLs loaded as extra instructions.</div>

        <div class="flex flex-wrap gap-2">
          <span
            v-for="it in instructionsArr"
            :key="`ins:${it}`"
            class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/20 px-2 py-1 text-xs"
          >
            <span class="font-mono break-all">{{ it }}</span>
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground"
              @click="instructionsArr = removeFromList(instructionsArr, it)"
            >
              ×
            </button>
          </span>
          <span v-if="instructionsArr.length === 0" class="text-xs text-muted-foreground">No instructions added.</span>
        </div>

        <div class="flex items-center gap-2">
          <input
            v-model="instructionsInput"
            class="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            placeholder="/path/to/instructions.md or https://…"
            @keydown.backspace="
              () => {
                if (!instructionsInput.trim() && instructionsArr.length) instructionsArr = instructionsArr.slice(0, -1)
              }
            "
            @keydown.enter.prevent="addInstructionsTags(instructionsInput)"
            @blur="instructionsInput.trim() && addInstructionsTags(instructionsInput)"
            @paste="
              (e) => {
                const text = (e as ClipboardEvent).clipboardData?.getData('text') || ''
                if (text) {
                  e.preventDefault()
                  addInstructionsTags(text)
                }
              }
            "
          />
          <Tooltip>
            <Button
              size="icon"
              variant="outline"
              class="h-9 w-9"
              title="Add"
              aria-label="Add instruction"
              @click="addInstructionsTags(instructionsInput)"
              :disabled="!instructionsInput.trim()"
            >
              <RiAddLine class="h-4 w-4" />
            </Button>
            <template #content>Add</template>
          </Tooltip>
        </div>
      </div>

      <div class="rounded-md border border-border p-3 space-y-2">
        <div class="flex items-center justify-between">
          <div class="text-sm font-semibold">Skills paths</div>
          <Tooltip>
            <Button
              size="icon"
              variant="ghost"
              class="h-8 w-8"
              title="Clear"
              aria-label="Clear skills paths"
              @click="skillsPathsArr = []"
            >
              <RiCloseLine class="h-4 w-4" />
            </Button>
            <template #content>Clear</template>
          </Tooltip>
        </div>
        <div class="text-[11px] text-muted-foreground">Additional folders that contain reusable OpenCode skills.</div>

        <div class="flex flex-wrap gap-2">
          <span
            v-for="it in skillsPathsArr"
            :key="`skill:${it}`"
            class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/20 px-2 py-1 text-xs"
          >
            <span class="font-mono break-all">{{ it }}</span>
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground"
              @click="skillsPathsArr = removeFromList(skillsPathsArr, it)"
            >
              ×
            </button>
          </span>
          <span v-if="skillsPathsArr.length === 0" class="text-xs text-muted-foreground">No skill paths added.</span>
        </div>

        <div class="flex items-center gap-2">
          <input
            v-model="skillsPathsInput"
            class="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            placeholder="/path/to/skills"
            @keydown.backspace="
              () => {
                if (!skillsPathsInput.trim() && skillsPathsArr.length) skillsPathsArr = skillsPathsArr.slice(0, -1)
              }
            "
            @keydown.enter.prevent="addSkillsPathsTags(skillsPathsInput)"
            @blur="skillsPathsInput.trim() && addSkillsPathsTags(skillsPathsInput)"
            @paste="
              (e) => {
                const text = (e as ClipboardEvent).clipboardData?.getData('text') || ''
                if (text) {
                  e.preventDefault()
                  addSkillsPathsTags(text)
                }
              }
            "
          />
          <Tooltip>
            <Button
              size="icon"
              variant="outline"
              class="h-9 w-9"
              title="Add"
              aria-label="Add skill path"
              @click="addSkillsPathsTags(skillsPathsInput)"
              :disabled="!skillsPathsInput.trim()"
            >
              <RiAddLine class="h-4 w-4" />
            </Button>
            <template #content>Add</template>
          </Tooltip>
        </div>
      </div>

      <div class="rounded-md border border-border p-3 space-y-2">
        <div class="flex items-center justify-between">
          <div class="text-sm font-semibold">Plugins</div>
          <Tooltip>
            <Button
              size="icon"
              variant="ghost"
              class="h-8 w-8"
              title="Clear"
              aria-label="Clear plugins"
              @click="pluginsArr = []"
            >
              <RiCloseLine class="h-4 w-4" />
            </Button>
            <template #content>Clear</template>
          </Tooltip>
        </div>
        <div class="text-[11px] text-muted-foreground">NPM specifiers or local file URLs (e.g. file:./plugin.js).</div>

        <div class="flex flex-wrap gap-2">
          <span
            v-for="it in pluginsArr"
            :key="`plug:${it}`"
            class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/20 px-2 py-1 text-xs"
          >
            <span class="font-mono break-all">{{ it }}</span>
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground"
              @click="pluginsArr = removeFromList(pluginsArr, it)"
            >
              ×
            </button>
          </span>
          <span v-if="pluginsArr.length === 0" class="text-xs text-muted-foreground">No plugins added.</span>
        </div>

        <div class="flex items-center gap-2">
          <input
            v-model="pluginsInput"
            class="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            placeholder="@scope/name@version or file:…"
            @keydown.backspace="
              () => {
                if (!pluginsInput.trim() && pluginsArr.length) pluginsArr = pluginsArr.slice(0, -1)
              }
            "
            @keydown.enter.prevent="addPluginsTags(pluginsInput)"
            @blur="pluginsInput.trim() && addPluginsTags(pluginsInput)"
            @paste="
              (e) => {
                const text = (e as ClipboardEvent).clipboardData?.getData('text') || ''
                if (text) {
                  e.preventDefault()
                  addPluginsTags(text)
                }
              }
            "
          />
          <Tooltip>
            <Button
              size="icon"
              variant="outline"
              class="h-9 w-9"
              title="Add"
              aria-label="Add plugin"
              @click="addPluginsTags(pluginsInput)"
              :disabled="!pluginsInput.trim()"
            >
              <RiAddLine class="h-4 w-4" />
            </Button>
            <template #content>Add</template>
          </Tooltip>
        </div>
      </div>
    </div>
  </section>
</template>
