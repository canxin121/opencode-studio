<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RiArrowLeftSLine, RiArrowRightSLine, RiCheckLine, RiCloseLine, RiShieldKeyholeLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import Input from '@/components/ui/Input.vue'
import { useChatStore } from '@/stores/chat'
import { useToastsStore } from '@/stores/toasts'

type AttentionKind = 'permission' | 'question'
type PayloadValue = unknown
type PayloadRecord = Record<string, PayloadValue>

const props = defineProps<{
  kind: AttentionKind
  sessionId: string
  payload: PayloadValue
}>()

const chat = useChatStore()
const toasts = useToastsStore()

const busy = ref(false)

const requestId = computed(() => {
  const payload = asRecord(props.payload)
  const properties = asRecord(payload?.properties)
  const id = properties?.id
  return typeof id === 'string' ? id.trim() : ''
})

type QuestionInfo = {
  header: string
  question: string
  options: Array<{ label: string; description?: string }>
  multiple?: boolean
  custom?: boolean
}

function asRecord(value: PayloadValue): PayloadRecord | null {
  return value && typeof value === 'object' ? (value as PayloadRecord) : null
}

function asStringArray(value: PayloadValue): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

const questions = computed<QuestionInfo[]>(() => {
  const payload = asRecord(props.payload)
  const properties = asRecord(payload?.properties)
  const list = properties?.questions
  if (!Array.isArray(list)) return []
  return list
    .map((q) => {
      const questionRecord = asRecord(q)
      const header = typeof questionRecord?.header === 'string' ? questionRecord.header : ''
      const question = typeof questionRecord?.question === 'string' ? questionRecord.question : ''
      const options = Array.isArray(questionRecord?.options)
        ? questionRecord.options
            .map((o) => {
              const optionRecord = asRecord(o)
              return {
                label: typeof optionRecord?.label === 'string' ? optionRecord.label : '',
                description: typeof optionRecord?.description === 'string' ? optionRecord.description : undefined,
              }
            })
            .filter((o) => Boolean(o.label))
        : []
      const multiple = Boolean(questionRecord?.multiple)
      const custom = questionRecord?.custom !== false
      return { header, question, options, multiple, custom } as QuestionInfo
    })
    .filter((q: QuestionInfo) => q.question && q.header)
})

type PermissionRequest = {
  permission: string
  patterns: string[]
  always: string[]
}

const permission = computed<PermissionRequest>(() => {
  const payload = asRecord(props.payload)
  const propsRec = asRecord(payload?.properties)
  return {
    permission: typeof propsRec?.permission === 'string' ? propsRec.permission : '',
    patterns: asStringArray(propsRec?.patterns),
    always: asStringArray(propsRec?.always),
  }
})

const selected = ref<string[][]>([])
const customText = ref<string[]>([])
const questionPage = ref(0)

// Internal sentinel for the "Custom" choice.
// Never send this value to the backend.
const CUSTOM_CHOICE = '__oc_custom__'

const questionCount = computed(() => questions.value.length)
const questionIndex = computed(() => {
  const count = questionCount.value
  if (count <= 0) return -1
  return Math.min(Math.max(questionPage.value, 0), count - 1)
})
const currentQuestion = computed<QuestionInfo | null>(() => {
  const idx = questionIndex.value
  if (idx < 0) return null
  return questions.value[idx] || null
})

function customLabelFor(q: QuestionInfo): string {
  if (!q?.custom) return ''

  // Some backends include the "Type your own answer" option explicitly.
  const normalized = (v: PayloadValue) => (typeof v === 'string' ? v.trim().toLowerCase() : '')
  const byLabel = new Map(q.options.map((o) => [normalized(o?.label), o?.label]))
  const existing = byLabel.get('type your own answer') || byLabel.get('custom')
  return existing || CUSTOM_CHOICE
}

function ensureAnswerSlots() {
  const q = questions.value
  if (selected.value.length !== q.length) {
    selected.value = q.map(() => [])
  }
  if (customText.value.length !== q.length) {
    customText.value = q.map(() => '')
  }
}

watch(
  () => requestId.value,
  () => {
    questionPage.value = 0
    selected.value = []
    customText.value = []
    ensureAnswerSlots()
  },
  { immediate: true },
)

watch(
  () => questions.value.length,
  (len) => {
    ensureAnswerSlots()
    if (len <= 0) {
      questionPage.value = 0
      return
    }
    if (questionPage.value > len - 1) {
      questionPage.value = len - 1
    }
  },
)

function prevQuestionPage() {
  if (questionIndex.value <= 0) return
  questionPage.value = questionIndex.value - 1
}

function nextQuestionPage() {
  if (questionIndex.value < 0 || questionIndex.value >= questionCount.value - 1) return
  questionPage.value = questionIndex.value + 1
}

function toggleChoice(qi: number, label: string) {
  const q = questions.value[qi]
  if (!q) return
  const current = selected.value[qi] || []
  if (q.multiple) {
    if (current.includes(label)) {
      selected.value[qi] = current.filter((x) => x !== label)
    } else {
      selected.value[qi] = [...current, label]
    }
  } else {
    selected.value[qi] = [label]
  }
}

function isChecked(qi: number, label: string): boolean {
  return (selected.value[qi] || []).includes(label)
}

function buildAnswers(): string[][] {
  const out: string[][] = []
  for (let i = 0; i < questions.value.length; i += 1) {
    const q = questions.value[i]
    const customLabel = q ? customLabelFor(q) : ''
    const picked = (selected.value[i] || []).slice()
    const base = customLabel ? picked.filter((x) => x !== customLabel) : picked
    const wantsCustom = Boolean(q?.custom && customLabel && picked.includes(customLabel))
    const typed = (customText.value[i] || '').trim()

    if (wantsCustom) {
      if (typed) {
        out.push(q?.multiple ? [...base, typed] : [typed])
      } else {
        // If "Custom" is selected but empty, treat as unanswered.
        out.push(base)
      }
      continue
    }

    out.push(base)
  }
  return out
}

function isAnswerFilled(answer: string[]): boolean {
  return Array.isArray(answer) && answer.length > 0 && answer.every((x) => typeof x === 'string' && x.trim())
}

function answersComplete(ans: string[][]): boolean {
  if (!ans.length) return false
  return ans.every((a) => isAnswerFilled(a))
}

const answerState = computed(() => buildAnswers())
const answeredByQuestion = computed(() => answerState.value.map((a) => isAnswerFilled(a)))
const currentQuestionAnswered = computed(() => {
  const idx = questionIndex.value
  if (idx < 0) return false
  return Boolean(answeredByQuestion.value[idx])
})
const questionAnswersReady = computed(() => answersComplete(answerState.value))
const canSendQuestion = computed(() => {
  if (props.kind !== 'question') return false
  return !busy.value && Boolean(requestId.value) && questionAnswersReady.value
})

async function submitPermission(reply: 'once' | 'always' | 'reject') {
  const rid = requestId.value
  if (!rid) return
  busy.value = true
  try {
    await chat.replyPermission(props.sessionId, rid, reply)
    toasts.push('success', reply === 'reject' ? 'Permission rejected' : 'Permission granted')
  } catch (err) {
    toasts.push('error', err instanceof Error ? err.message : String(err))
  } finally {
    busy.value = false
  }
}

async function submitQuestion() {
  const rid = requestId.value
  if (!rid) return
  const ans = buildAnswers()
  if (!answersComplete(ans)) {
    toasts.push('error', 'Please answer all questions')
    return
  }
  busy.value = true
  try {
    await chat.replyQuestion(props.sessionId, rid, ans)
    toasts.push('success', 'Answer sent')
  } catch (err) {
    toasts.push('error', err instanceof Error ? err.message : String(err))
  } finally {
    busy.value = false
  }
}

async function rejectQuestion() {
  const rid = requestId.value
  if (!rid) return
  busy.value = true
  try {
    await chat.rejectQuestion(props.sessionId, rid)
    toasts.push('success', 'Question rejected')
  } catch (err) {
    toasts.push('error', err instanceof Error ? err.message : String(err))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Card class="border-input bg-background flex min-h-0 flex-col overflow-hidden">
    <div class="shrink-0 border-b border-border/60 px-3 py-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="typography-ui-label font-semibold">
            {{ kind === 'permission' ? 'Permission required' : 'Question' }}
          </div>
          <div class="typography-micro text-muted-foreground">
            {{
              kind === 'question' && !questionAnswersReady
                ? 'Answer all questions to enable send.'
                : 'This blocks the agent until you respond.'
            }}
          </div>
        </div>

        <div class="flex items-center justify-end gap-1.5 shrink-0">
          <template v-if="kind === 'permission'">
            <Button
              size="icon"
              variant="ghost"
              class="h-8 w-8"
              :disabled="busy"
              title="Reject permission"
              aria-label="Reject permission"
              @click="submitPermission('reject')"
            >
              <RiCloseLine class="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              class="h-8 w-8"
              :disabled="busy"
              title="Allow once"
              aria-label="Allow once"
              @click="submitPermission('once')"
            >
              <RiCheckLine class="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="default"
              class="h-8 w-8"
              :disabled="busy"
              title="Always allow"
              aria-label="Always allow"
              @click="submitPermission('always')"
            >
              <RiShieldKeyholeLine class="h-4 w-4" />
            </Button>
          </template>
          <template v-else>
            <Button
              size="icon"
              variant="ghost"
              class="h-8 w-8"
              :disabled="busy"
              title="Reject question"
              aria-label="Reject question"
              @click="rejectQuestion"
            >
              <RiCloseLine class="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="default"
              class="h-8 w-8"
              :disabled="!canSendQuestion"
              title="Send answers"
              aria-label="Send answers"
              @click="submitQuestion"
            >
              <RiCheckLine class="h-4 w-4" />
            </Button>
          </template>
        </div>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div v-if="kind === 'permission'" class="space-y-2">
        <div class="text-xs">
          <div class="text-muted-foreground/80">Permission</div>
          <div class="font-mono text-[11px] break-words">{{ permission.permission }}</div>
        </div>

        <div v-if="permission.patterns.length" class="text-xs">
          <div class="text-muted-foreground/80">Patterns</div>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <span
              v-for="p in permission.patterns"
              :key="p"
              class="inline-flex items-center rounded-full bg-secondary/60 px-2 py-0.5 font-mono text-[10px] text-foreground/90"
            >
              {{ p }}
            </span>
          </div>
        </div>

        <div v-if="permission.always.length" class="text-xs">
          <div class="text-muted-foreground/80">Will be remembered for</div>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <span
              v-for="p in permission.always"
              :key="p"
              class="inline-flex items-center rounded-full bg-secondary/60 px-2 py-0.5 font-mono text-[10px] text-foreground/90"
            >
              {{ p }}
            </span>
          </div>
        </div>
      </div>

      <div v-else class="space-y-3 min-w-0">
        <div v-if="questionCount > 1" class="flex items-center justify-between gap-2 px-0.5">
          <Button
            size="icon"
            variant="ghost"
            class="h-7 w-7"
            :disabled="busy || questionIndex <= 0"
            title="Previous question"
            aria-label="Previous question"
            @click="prevQuestionPage"
          >
            <RiArrowLeftSLine class="h-4 w-4" />
          </Button>
          <div class="inline-flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground">
            <span>Question {{ questionIndex + 1 }} / {{ questionCount }}</span>
            <RiCheckLine v-if="currentQuestionAnswered" class="h-3.5 w-3.5 text-emerald-500" />
          </div>
          <Button
            size="icon"
            variant="ghost"
            class="h-7 w-7"
            :disabled="busy || questionIndex >= questionCount - 1"
            title="Next question"
            aria-label="Next question"
            @click="nextQuestionPage"
          >
            <RiArrowRightSLine class="h-4 w-4" />
          </Button>
        </div>

        <div v-if="currentQuestion && questionIndex >= 0" :key="`${requestId}:${questionIndex}`" class="space-y-3">
          <div class="space-y-1">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="text-xs font-semibold break-words">{{ currentQuestion.header }}</div>
              </div>
              <div class="text-[10px] text-muted-foreground font-mono shrink-0">
                {{ currentQuestion.multiple ? 'multiple' : 'single' }}
              </div>
            </div>
            <div class="text-xs text-muted-foreground whitespace-pre-wrap break-words">
              {{ currentQuestion.question }}
            </div>
          </div>

          <div class="overflow-hidden rounded-md bg-secondary/20 divide-y divide-border/35">
            <label
              v-for="opt in currentQuestion.options"
              :key="opt.label"
              class="flex items-start gap-2 px-2.5 py-2 transition-colors"
              :class="isChecked(questionIndex, opt.label) ? 'bg-secondary/45' : 'hover:bg-secondary/30'"
            >
              <input
                :type="currentQuestion.multiple ? 'checkbox' : 'radio'"
                :name="`q-${requestId}-${questionIndex}`"
                class="mt-0.5"
                :checked="isChecked(questionIndex, opt.label)"
                @change="toggleChoice(questionIndex, opt.label)"
              />
              <div class="min-w-0">
                <div class="text-xs font-medium break-words">{{ opt.label }}</div>
                <div v-if="opt.description" class="text-[11px] text-muted-foreground break-words">
                  {{ opt.description }}
                </div>
              </div>
            </label>

            <label
              v-if="currentQuestion.custom && customLabelFor(currentQuestion) === CUSTOM_CHOICE"
              class="flex items-start gap-2 px-2.5 py-2 transition-colors"
              :class="isChecked(questionIndex, CUSTOM_CHOICE) ? 'bg-secondary/45' : 'hover:bg-secondary/30'"
            >
              <input
                :type="currentQuestion.multiple ? 'checkbox' : 'radio'"
                :name="`q-${requestId}-${questionIndex}`"
                class="mt-0.5"
                :checked="isChecked(questionIndex, CUSTOM_CHOICE)"
                @change="toggleChoice(questionIndex, CUSTOM_CHOICE)"
              />
              <div class="min-w-0">
                <div class="text-xs font-medium">Custom</div>
                <div class="text-[11px] text-muted-foreground">Type your own answer</div>
              </div>
            </label>

            <div
              v-if="
                currentQuestion.custom &&
                customLabelFor(currentQuestion) &&
                isChecked(questionIndex, customLabelFor(currentQuestion))
              "
              class="px-2.5 py-2 bg-background/70"
            >
              <Input
                v-model="customText[questionIndex]"
                placeholder="Type your own answer"
                class="h-8 text-xs"
                :disabled="busy"
              />
              <div class="mt-1 text-[11px] text-muted-foreground">Only sent when the custom option is selected.</div>
            </div>
          </div>
        </div>

        <div v-else class="text-xs text-muted-foreground">No questions available.</div>
      </div>
    </div>
  </Card>
</template>
