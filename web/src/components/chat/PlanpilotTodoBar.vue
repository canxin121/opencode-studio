<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  RiArrowDownSLine,
  RiCheckLine,
  RiEyeOffLine,
  RiListCheck2,
  RiPlayList2Line,
  RiRefreshLine,
  RiStackLine,
  RiTimeLine,
} from '@remixicon/vue'

import IconButton from '@/components/ui/IconButton.vue'
import { subscribeHostPluginEvents } from '@/plugins/host/sdk'
import { usePluginHostStore } from '@/stores/pluginHost'
import { useUiStore } from '@/stores/ui'
import type { JsonValue as JsonLike } from '@/types/json'

type PlanStatus = 'todo' | 'done'
type StepStatus = 'todo' | 'done'
type GoalStatus = 'todo' | 'done'

type PlanRow = {
  id: number
  title: string
  content: string
  status: PlanStatus
  comment: string | null
  last_session_id: string | null
  updated_at: number
}

type StepRow = {
  id: number
  plan_id: number
  content: string
  status: StepStatus
  executor: 'ai' | 'human'
  sort_order: number
  comment: string | null
}

type GoalRow = {
  id: number
  step_id: number
  content: string
  status: GoalStatus
}

type RuntimeStepDetail = {
  step: StepRow
  goals: GoalRow[]
  wait?: { until: number; reason?: string } | null
}

type RuntimeSnapshot = {
  paused: boolean
  activePlan: { plan_id: number } | null
  nextStep: RuntimeStepDetail | null
}

type PlanDetail = {
  plan: PlanRow
  steps: StepRow[]
  goals: Array<{ stepId: number; goals: GoalRow[] }>
}

const props = defineProps<{
  sessionId: string | null
}>()

const emit = defineEmits<{
  (event: 'reserve-change', px: number): void
}>()

const pluginHost = usePluginHostStore()
const ui = useUiStore()

const loading = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const showOtherPlans = ref(false)
const collapsed = ref(false)
const viewedPlanId = ref(0)

const rootEl = ref<HTMLElement | null>(null)
const reservedPx = ref(0)

const goalsExpandedByStepId = ref<Record<string, boolean>>({})

let reserveObserver: ResizeObserver | null = null
let reserveRaf = 0

const runtime = ref<RuntimeSnapshot | null>(null)
const activePlanDetail = ref<PlanDetail | null>(null)
const sessionPlans = ref<PlanRow[]>([])

let stopEvents: (() => void) | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

const sessionIdValue = computed(() => String(props.sessionId || '').trim())

const planpilotPluginId = computed(() => {
  if (pluginHost.readyPlugins.some((item) => item.id === 'opencode-planpilot')) return 'opencode-planpilot'
  const fallback = pluginHost.readyPlugins.find((item) => item.id.toLowerCase().includes('planpilot'))
  return fallback?.id || ''
})

const isVisible = computed(() => !!planpilotPluginId.value && !!sessionIdValue.value)
const activePlan = computed(() => activePlanDetail.value?.plan || null)
const activeRuntimePlanId = computed(() => runtime.value?.activePlan?.plan_id ?? 0)
const hasRuntimeActivePlan = computed(() => activeRuntimePlanId.value > 0)
const activePlanId = computed(() => activePlan.value?.id ?? 0)

function deriveNextStepFromDetail(detail: PlanDetail | null): RuntimeStepDetail | null {
  if (!detail) return null
  const pendingStep = [...detail.steps]
    .filter((step) => step.status !== 'done')
    .sort((left, right) => {
      if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order
      return left.id - right.id
    })[0]
  if (!pendingStep) return null
  const goals = detail.goals.find((entry) => entry.stepId === pendingStep.id)?.goals || []
  return {
    step: pendingStep,
    goals,
    wait: null,
  }
}

const nextStep = computed(() => {
  if (activePlanId.value > 0 && activePlanId.value === activeRuntimePlanId.value) {
    return runtime.value?.nextStep || null
  }
  return deriveNextStepFromDetail(activePlanDetail.value)
})
const nextStepId = computed(() => nextStep.value?.step.id ?? 0)
const nextStepWaitLabel = computed(() => formattedWait(nextStep.value))

const orderedSteps = computed(() => {
  const detail = activePlanDetail.value
  if (!detail) return []
  return [...detail.steps].sort((left, right) => {
    if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order
    return left.id - right.id
  })
})

const isCompactViewport = computed(() => ui.isMobilePointer || ui.isMobile)

const stepsVisibleRows = computed(() => 5)
const plansVisibleRows = computed(() => 5)

const stepsRowHeightPx = computed(() => 38)
// Plan rows use `h-8` (32px) + 1px top/bottom border.
const plansRowHeightPx = computed(() => 34)
const listGapPx = computed(() => 2)

function listViewportMaxHeightPx(rows: number, rowHeight: number, gapPx: number): number {
  const safeRows = Number.isFinite(rows) ? Math.max(0, Math.trunc(rows)) : 0
  const safeRowHeight = Number.isFinite(rowHeight) ? Math.max(0, Math.trunc(rowHeight)) : 0
  const safeGap = Number.isFinite(gapPx) ? Math.max(0, Math.trunc(gapPx)) : 0
  const gapCount = Math.max(0, safeRows - 1)
  return safeRows * safeRowHeight + gapCount * safeGap
}

const stepsViewportStyle = computed(() => ({
  maxHeight: `${listViewportMaxHeightPx(stepsVisibleRows.value, stepsRowHeightPx.value, listGapPx.value)}px`,
}))

const plansViewportStyle = computed(() => ({
  maxHeight: `${listViewportMaxHeightPx(plansVisibleRows.value, plansRowHeightPx.value, listGapPx.value)}px`,
}))

type GoalsByStepId = Record<string, GoalRow[]>

const goalsByStepId = computed<GoalsByStepId>(() => {
  const detail = activePlanDetail.value
  const out: GoalsByStepId = {}
  if (!detail) return out

  for (const entry of detail.goals) {
    const key = String(entry.stepId)
    const list = Array.isArray(entry.goals) ? entry.goals : []
    out[key] = [...list].sort((left, right) => left.id - right.id)
  }
  return out
})

function goalsForStepId(stepId: number): GoalRow[] {
  if (nextStepId.value && stepId === nextStepId.value) {
    const runtimeGoals = nextStep.value?.goals
    if (Array.isArray(runtimeGoals) && runtimeGoals.length) return runtimeGoals
  }
  return goalsByStepId.value[String(stepId)] || []
}

function isGoalsExpanded(stepId: number): boolean {
  return goalsExpandedByStepId.value[String(stepId)] === true
}

function toggleGoalsExpanded(stepId: number) {
  const key = String(stepId)
  goalsExpandedByStepId.value = {
    ...goalsExpandedByStepId.value,
    [key]: !(goalsExpandedByStepId.value[key] === true),
  }
}

watch(
  () => activePlanDetail.value?.plan.id ?? 0,
  () => {
    goalsExpandedByStepId.value = {}
  },
)

function setReservedPx(px: number) {
  const next = Number.isFinite(px) && px > 0 ? Math.max(0, Math.floor(px)) : 0
  if (next === reservedPx.value) return
  reservedPx.value = next
  emit('reserve-change', next)
}

function computeReserveFromEl(el: HTMLElement): number {
  const rect = el.getBoundingClientRect()
  if (!Number.isFinite(rect.height) || rect.height <= 0) return 0
  // The parent container positions this widget with `bottom-2`.
  // Add that spacing so the message list clears the overlay.
  const bottomGap = 8
  return Math.max(0, Math.ceil(rect.height + bottomGap))
}

function scheduleReserveUpdate() {
  if (reserveRaf) return
  if (typeof window === 'undefined') return
  reserveRaf = window.requestAnimationFrame(() => {
    reserveRaf = 0
    const el = rootEl.value
    if (!el || !isVisible.value) {
      setReservedPx(0)
      return
    }
    setReservedPx(computeReserveFromEl(el))
  })
}

const headerLabel = computed(() => {
  if (activePlan.value) return `#${activePlan.value.id} ${activePlan.value.title}`
  // If showing a fallback/viewed plan that isn't active
  if (activePlanDetail.value?.plan) {
    const p = activePlanDetail.value.plan
    return `#${p.id} ${p.title} (viewing)`
  }
  if (loading.value) return 'Loading...'
  return 'No plans'
})

const planContent = computed(() => {
  const content = activePlanDetail.value?.plan.content
  const normalized = String(content || '').trim()
  return normalized
})

const fallbackStatusMessage = computed(() => {
  if (loading.value && !activePlanDetail.value) return 'Checking plan status...'
  if (!activePlanDetail.value) {
    if (sessionPlans.value.length === 0) {
      return 'No plans found for this session yet. Open Settings > Plan to create one.'
    }
    return 'No plan is selected right now. Open Plan List to review a recent plan.'
  }
  return ''
})

function asObject(value: JsonLike | null | undefined): Record<string, JsonLike> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, JsonLike>
}

function asArray(value: JsonLike | null | undefined): JsonLike[] {
  return Array.isArray(value) ? value : []
}

function toNumber(value: JsonLike | undefined, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.trunc(value)
}

function toStringValue(value: JsonLike | undefined, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

function parseGoal(value: JsonLike): GoalRow | null {
  const obj = asObject(value)
  const id = toNumber(obj.id)
  const stepId = toNumber(obj.step_id)
  const content = toStringValue(obj.content)
  if (!id || !stepId || !content) return null
  return {
    id,
    step_id: stepId,
    content,
    status: toStringValue(obj.status) === 'done' ? 'done' : 'todo',
  }
}

function parseStep(value: JsonLike): StepRow | null {
  const obj = asObject(value)
  const id = toNumber(obj.id)
  const planId = toNumber(obj.plan_id)
  const content = toStringValue(obj.content)
  if (!id || !planId || !content) return null
  return {
    id,
    plan_id: planId,
    content,
    status: toStringValue(obj.status) === 'done' ? 'done' : 'todo',
    executor: toStringValue(obj.executor) === 'human' ? 'human' : 'ai',
    sort_order: toNumber(obj.sort_order),
    comment: typeof obj.comment === 'string' ? obj.comment : null,
  }
}

function parsePlan(value: JsonLike): PlanRow | null {
  const obj = asObject(value)
  const id = toNumber(obj.id)
  const title = toStringValue(obj.title)
  if (!id || !title) return null
  return {
    id,
    title,
    content: toStringValue(obj.content),
    status: toStringValue(obj.status) === 'done' ? 'done' : 'todo',
    comment: typeof obj.comment === 'string' ? obj.comment : null,
    last_session_id: typeof obj.last_session_id === 'string' ? obj.last_session_id : null,
    updated_at: toNumber(obj.updated_at),
  }
}

function parseRuntime(value: JsonLike): RuntimeSnapshot | null {
  const obj = asObject(value)
  const activeObj = asObject(obj.activePlan)
  const nextObj = asObject(obj.nextStep)
  const nextStepRow = parseStep(nextObj.step)
  const nextGoals = asArray(nextObj.goals).map(parseGoal).filter((goal): goal is GoalRow => !!goal)
  const waitObj = asObject(nextObj.wait)

  const nextStepDetail: RuntimeStepDetail | null = nextStepRow
    ? {
        step: nextStepRow,
        goals: nextGoals,
        wait: waitObj.until
          ? {
              until: toNumber(waitObj.until),
              reason: toStringValue(waitObj.reason) || undefined,
            }
          : null,
      }
    : null

  return {
    paused: obj.paused === true,
    activePlan: activeObj.plan_id ? { plan_id: toNumber(activeObj.plan_id) } : null,
    nextStep: nextStepDetail,
  }
}

function parsePlanDetail(value: JsonLike): PlanDetail | null {
  const obj = asObject(value)
  const plan = parsePlan(obj.plan)
  if (!plan) return null

  const steps = asArray(obj.steps).map(parseStep).filter((step): step is StepRow => !!step)
  const goals = asArray(obj.goals)
    .map((entry) => {
      const e = asObject(entry)
      const stepId = toNumber(e.stepId)
      if (!stepId) return null
      const list = asArray(e.goals).map(parseGoal).filter((goal): goal is GoalRow => !!goal)
      return { stepId, goals: list }
    })
    .filter((entry): entry is { stepId: number; goals: GoalRow[] } => !!entry)

  return { plan, steps, goals }
}


function formattedWait(stepDetail: RuntimeStepDetail | null): string {
  const wait = stepDetail?.wait
  if (!wait?.until) return ''
  const when = new Date(wait.until)
  if (Number.isNaN(when.getTime())) return ''
  const time = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return wait.reason ? `${time} (${wait.reason})` : time
}

function summarizePlanContent(content: string): string {
  const normalized = String(content || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= 92) return normalized
  return `${normalized.slice(0, 92)}...`
}

async function invoke(action: string, payload: JsonLike = null): Promise<JsonLike> {
  const pluginId = planpilotPluginId.value
  if (!pluginId) throw new Error('Planpilot plugin is unavailable')

  const context = sessionIdValue.value ? ({ sessionId: sessionIdValue.value } as JsonLike) : null
  const response = await pluginHost.action(pluginId, action, payload, context)
  if (!response.ok) {
    throw new Error(response.error?.message || `Action failed: ${action}`)
  }
  return response.data ?? null
}

async function refreshAll() {
  if (!isVisible.value) {
    runtime.value = null
    activePlanDetail.value = null
    sessionPlans.value = []
    error.value = null
    loading.value = false
    return
  }

  loading.value = true
  error.value = null
  try {
    const [runtimeRaw, activeRaw, plansRaw] = await Promise.all([
      invoke('runtime.snapshot'),
      invoke('plan.active'),
      invoke('plan.list', {}),
    ])

    runtime.value = parseRuntime(runtimeRaw)

    const activeObj = asObject(activeRaw)
    const activeDetail = parsePlanDetail(activeObj.detail)

    const parsedPlans = asArray(plansRaw)
      .map(parsePlan)
      .filter((plan): plan is PlanRow => !!plan)
      .filter((plan) => plan.last_session_id === sessionIdValue.value)
      .sort((left, right) => {
        if (left.updated_at !== right.updated_at) return right.updated_at - left.updated_at
        return right.id - left.id
      })

    sessionPlans.value = parsedPlans

    const planIdSet = new Set(parsedPlans.map((plan) => plan.id))
    if (viewedPlanId.value > 0 && !planIdSet.has(viewedPlanId.value)) {
      viewedPlanId.value = 0
    }

    const fallbackRecentPlanId = parsedPlans[0]?.id ?? 0
    const targetPlanId =
      viewedPlanId.value > 0
        ? viewedPlanId.value
        : activeDetail?.plan?.id || fallbackRecentPlanId

    if (!targetPlanId) {
      activePlanDetail.value = null
      return
    }

    if (activeDetail && activeDetail.plan.id === targetPlanId) {
      activePlanDetail.value = activeDetail
    } else {
      const detailRaw = await invoke('plan.get', { id: targetPlanId })
      activePlanDetail.value = parsePlanDetail(detailRaw)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    runtime.value = null
    activePlanDetail.value = null
    sessionPlans.value = []
  } finally {
    loading.value = false
  }
}

function scheduleRefresh(delayMs = 120) {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void refreshAll()
  }, delayMs)
}

function resetEventSubscription() {
  stopEvents?.()
  stopEvents = null

  if (!planpilotPluginId.value) return
  stopEvents = subscribeHostPluginEvents(planpilotPluginId.value, {
    onEvent: () => scheduleRefresh(90),
    onError: () => {
      // Keep UI stable while host SSE reconnects.
    },
  })
}

function toggleCollapsed() {
  collapsed.value = !collapsed.value
  if (collapsed.value) {
    showOtherPlans.value = false
  } else {
    // Auto-refresh when expanding
    void refreshAll()
  }
}

async function openPlan(planId: number) {
  if (!planId || busy.value) return
  busy.value = true
  try {
    showOtherPlans.value = false
    const detailRaw = await invoke('plan.get', { id: planId })
    const detail = parsePlanDetail(detailRaw)
    if (!detail) {
      throw new Error('Plan detail is unavailable')
    }
    viewedPlanId.value = planId
    activePlanDetail.value = detail
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

watch(
  () => rootEl.value,
  (el) => {
    reserveObserver?.disconnect()
    reserveObserver = null

    if (!el) {
      setReservedPx(0)
      return
    }

    if (typeof ResizeObserver === 'undefined') {
      scheduleReserveUpdate()
      return
    }

    reserveObserver = new ResizeObserver(() => scheduleReserveUpdate())
    reserveObserver.observe(el)
    scheduleReserveUpdate()
  },
  { immediate: true },
)

watch(
  () => [sessionIdValue.value, planpilotPluginId.value],
  () => {
    showOtherPlans.value = false
    collapsed.value = true
    viewedPlanId.value = 0
    resetEventSubscription()
    void refreshAll()
  },
  { immediate: true },
)

watch(
  () => hasRuntimeActivePlan.value,
  (hasActivePlan) => {
    if (hasActivePlan) return
    collapsed.value = true
    showOtherPlans.value = false
  },
)

onMounted(() => {
  resetEventSubscription()
  void refreshAll()
})

onBeforeUnmount(() => {
  stopEvents?.()
  stopEvents = null
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  reserveObserver?.disconnect()
  reserveObserver = null
  if (reserveRaf && typeof window !== 'undefined') {
    window.cancelAnimationFrame(reserveRaf)
    reserveRaf = 0
  }
  setReservedPx(0)
})
</script>

<template>
  <div v-if="isVisible" ref="rootEl" class="pointer-events-none w-full flex justify-end">
    <transition name="planpilot-expand" mode="out-in">
      <div
        v-if="collapsed"
        class="pointer-events-auto p-1"
      >
        <IconButton
          size="sm"
          variant="secondary"
          class="h-9 w-9 rounded-full shadow-md border border-border/50 bg-background/80 backdrop-blur hover:bg-background transition-all"
          :disabled="busy"
          :loading="loading"
          title="Show plan"
          aria-label="Show plan"
          @click="toggleCollapsed"
        >
          <RiListCheck2 class="h-5 w-5 text-muted-foreground" />
        </IconButton>
      </div>

      <section
        v-else
        class="pointer-events-auto w-full rounded-lg border border-border/60 bg-background/95 shadow-xl backdrop-blur-md overflow-hidden transition-all duration-300 ease-in-out flex flex-col"
        :class="isCompactViewport ? 'max-h-[42vh]' : 'max-h-[50vh]'"
      >
        <!-- Header -->
        <div
          class="flex items-center border-b border-border/30 bg-muted/20"
          :class="isCompactViewport ? 'gap-1.5 px-1.5 py-0.5' : 'gap-2 px-2 py-1'"
        >
          <div class="flex items-center gap-1.5 min-w-0 flex-1">
            <span class="truncate text-[11px] font-semibold text-foreground/90 select-none cursor-default" :title="headerLabel">
              {{ headerLabel }}
            </span>
            <RiCheckLine
              v-if="activePlanDetail && activePlanDetail.plan.status === 'done'"
              class="h-3.5 w-3.5 shrink-0 text-emerald-700/70"
              title="Plan complete"
              aria-label="Plan complete"
            />
            <span v-if="loading" class="animate-pulse text-[10px] text-muted-foreground">Updating...</span>
          </div>

          <div class="flex items-center gap-0.5">
            <IconButton
              size="xs"
              variant="ghost"
              :disabled="busy"
              :loading="loading && !busy"
              title="Refresh"
              aria-label="Refresh"
              @click="scheduleRefresh(0)"
            >
              <RiRefreshLine class="h-3.5 w-3.5 text-muted-foreground/70" />
            </IconButton>

            <IconButton
              size="xs"
              :variant="showOtherPlans ? 'secondary' : 'ghost'"
              title="Plan List"
              aria-label="Plan List"
              :aria-pressed="showOtherPlans"
              @click="showOtherPlans = !showOtherPlans"
            >
              <RiPlayList2Line class="h-3.5 w-3.5" :class="showOtherPlans ? '' : 'text-muted-foreground/70'" />
            </IconButton>

            <div class="mx-1 h-3 w-px bg-border/50" />

            <IconButton
              size="xs"
              variant="ghost"
              title="Collapse"
              aria-label="Collapse"
              @click="toggleCollapsed"
            >
              <RiEyeOffLine class="h-3.5 w-3.5 text-muted-foreground/70" />
            </IconButton>
          </div>
        </div>

        <!-- Main Content Area -->
        <div
          class="overflow-hidden flex-1 min-h-0 flex flex-col"
          :class="isCompactViewport ? 'p-1 gap-1' : 'p-1.5 gap-1.5'"
        >
          <!-- Plan List Mode -->
          <div v-if="showOtherPlans" class="flex flex-col gap-1 min-h-0">
            <div v-if="sessionPlans.length === 0" class="px-2 py-2 text-center text-xs text-muted-foreground">
              No plans in this session.
            </div>

            <div
              v-else
              class="overflow-y-auto overscroll-contain flex-1 min-h-0"
              :style="plansViewportStyle"
            >
              <div class="flex flex-col gap-[2px]">
                <button
                  v-for="plan in sessionPlans"
                  :key="`session-plan-${plan.id}`"
                  type="button"
                  class="w-full h-8 text-left flex items-center gap-2 rounded-md border border-transparent px-2 transition-colors"
                  :class="plan.id === activePlanId ? 'bg-primary/5 border-primary/15' : 'hover:bg-muted/30'"
                  :disabled="busy"
                  :title="summarizePlanContent(plan.content) || `#${plan.id} ${plan.title}`"
                  @click="openPlan(plan.id)"
                >
                  <div class="min-w-0 flex-1 flex items-center gap-1.5">
                    <span class="min-w-0 text-xs font-medium truncate">#{{ plan.id }} {{ plan.title }}</span>
                    <span
                      v-if="plan.id === activeRuntimePlanId"
                      class="shrink-0 text-[10px] px-1 rounded bg-emerald-500/15 text-emerald-700"
                    >
                      Active
                    </span>
                  </div>

                  <RiCheckLine
                    v-if="plan.status === 'done'"
                    class="h-4 w-4 shrink-0 text-emerald-700/70"
                    aria-hidden="true"
                  />
                  <RiStackLine v-else class="h-4 w-4 shrink-0 text-muted-foreground/70" />
                </button>
              </div>
            </div>
          </div>

          <!-- Plan Detail Mode -->
          <div v-else-if="activePlanDetail" class="flex flex-col gap-1.5 min-h-0">
            <div
              v-if="planContent"
              class="text-[10px] text-muted-foreground leading-snug whitespace-pre-wrap break-words max-h-12 overflow-hidden"
              :title="planContent"
            >
              {{ planContent }}
            </div>

            <div v-if="runtime?.paused" class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span class="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Paused</span>
            </div>

            <div
              v-if="orderedSteps.length"
              class="overflow-y-auto overscroll-contain flex-1 min-h-0"
              :style="stepsViewportStyle"
            >
              <ol class="flex flex-col gap-[2px]">
              <li
                v-for="step in orderedSteps"
                :key="`step-${step.id}`"
                class="rounded-md border border-transparent transition-colors"
                :class="
                  step.id === nextStepId
                    ? 'bg-primary/5 border-primary/15'
                    : step.status === 'done'
                      ? 'bg-muted/20 border-border/30 hover:bg-muted/25'
                      : 'hover:bg-muted/30'
                "
              >
                <div
                  class="flex items-center gap-2 h-9 px-1.5"
                  :class="goalsForStepId(step.id).length ? 'cursor-pointer' : ''"
                  :role="goalsForStepId(step.id).length ? 'button' : undefined"
                  :tabindex="goalsForStepId(step.id).length ? 0 : undefined"
                  :aria-label="
                    goalsForStepId(step.id).length
                      ? isGoalsExpanded(step.id)
                        ? 'Collapse goals'
                        : 'Expand goals'
                      : undefined
                  "
                  :aria-expanded="goalsForStepId(step.id).length ? isGoalsExpanded(step.id) : undefined"
                  @click="goalsForStepId(step.id).length && toggleGoalsExpanded(step.id)"
                  @keydown.enter.prevent="goalsForStepId(step.id).length && toggleGoalsExpanded(step.id)"
                  @keydown.space.prevent="goalsForStepId(step.id).length && toggleGoalsExpanded(step.id)"
                >
                  <div class="min-w-0 flex-1">
                    <div
                      class="text-[13px] leading-[1.1] truncate"
                      :class="step.status === 'done' ? 'text-muted-foreground opacity-75' : 'text-foreground'"
                      :title="step.content"
                    >
                      {{ step.content }}
                    </div>
                  </div>

                  <div class="flex items-center gap-1 shrink-0">
                    <RiTimeLine
                      v-if="step.id === nextStepId && nextStepWaitLabel"
                      class="h-4 w-4 text-amber-600/70"
                      :title="`Waiting: ${nextStepWaitLabel}`"
                      aria-label="Waiting"
                    />

                    <RiCheckLine
                      v-if="step.status === 'done'"
                      class="h-4 w-4 text-emerald-700/70"
                      aria-hidden="true"
                    />

                    <RiArrowDownSLine
                      v-if="goalsForStepId(step.id).length"
                      class="h-4 w-4 text-muted-foreground/60 transition-transform"
                      :class="isGoalsExpanded(step.id) ? '' : '-rotate-90'"
                    />
                  </div>
                </div>

                <div
                  v-if="goalsForStepId(step.id).length && isGoalsExpanded(step.id)"
                  class="pb-1 pl-7 pr-1.5"
                >
                  <div class="space-y-0.5">
                    <div
                      v-for="goal in goalsForStepId(step.id)"
                      :key="`goal-${goal.id}`"
                      class="flex items-start gap-2"
                    >
                      <span
                        class="mt-2 h-px w-2 shrink-0"
                        :class="goal.status === 'done' ? 'bg-emerald-600/40' : 'bg-muted-foreground/35'"
                        aria-hidden="true"
                      />

                      <span
                        class="min-w-0 flex-1 text-[11px] text-muted-foreground leading-snug break-words whitespace-pre-wrap"
                        :class="goal.status === 'done' ? 'opacity-75' : ''"
                      >
                        {{ goal.content }}
                      </span>

                      <RiCheckLine
                        v-if="goal.status === 'done'"
                        class="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700/70"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                </div>
              </li>
              </ol>
            </div>

            <div v-else class="py-2 text-center text-xs text-muted-foreground italic leading-relaxed">
              This plan has no steps yet.
            </div>
          </div>

          <div v-else class="py-2 text-center text-xs text-muted-foreground italic leading-relaxed">
            {{ fallbackStatusMessage }}
          </div>

          <!-- Error Message -->
          <div v-if="error" class="rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive flex items-start gap-2">
             <span class="font-bold">Error:</span> {{ error }}
          </div>
        </div>
      </section>
    </transition>
  </div>
</template>

<style scoped>
.planpilot-expand-enter-active,
.planpilot-expand-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.planpilot-expand-enter-from,
.planpilot-expand-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}

.planpilot-panel-enter-active,
.planpilot-panel-leave-active {
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
}

.planpilot-panel-enter-from,
.planpilot-panel-leave-to {
  opacity: 0;
  max-height: 0;
}
</style>
