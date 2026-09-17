<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { useElementVisibility } from "@vueuse/core"
import { injectScrollAreaRootContext } from "reka-ui"
import type { TerminalLineEntry } from "./useTerminalOutput"

export interface ContentProps {
  entries?: readonly TerminalLineEntry[]
  class?: HTMLAttributes["class"]
}

const props = defineProps<ContentProps>()
const scrollContext = injectScrollAreaRootContext()
const visibilityElement = useTemplateRef("visibilityElement")
const viewportElement = computed(() => {
  return scrollContext.viewport.value
})

const isVisibilityElementVisible = useElementVisibility(visibilityElement, {
  scrollTarget: viewportElement,
  // rootMargin: '50% '.repeat(4),
})

function scrollToBottom() {
  if (!isVisibilityElementVisible.value) return

  viewportElement.value?.scrollTo({
    top: Number.MAX_SAFE_INTEGER
  })
}

defineExpose({ scrollToBottom })

</script>

<template>
  <slot />
  <div ref="visibilityElement" class="relative bottom-0"></div>
</template>
