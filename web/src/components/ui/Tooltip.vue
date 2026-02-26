<script setup lang="ts">
import {
  TooltipContent,
  TooltipPortal,
  TooltipRoot,
  type TooltipRootEmits,
  type TooltipRootProps,
  TooltipTrigger,
  TooltipProvider,
} from 'radix-vue'
import { tooltipContentClass, tooltipMotionClass } from '@/components/ui/tooltip.variants'
import { cn } from '@/lib/utils'
import { useForwardPropsEmits } from 'radix-vue'

const props = defineProps<TooltipRootProps & { contentClass?: string }>()
const emits = defineEmits<TooltipRootEmits>()

const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <TooltipProvider>
    <TooltipRoot v-bind="forwarded">
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent :class="cn(tooltipContentClass, tooltipMotionClass, props.contentClass)" :side-offset="4">
          <slot name="content" />
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
