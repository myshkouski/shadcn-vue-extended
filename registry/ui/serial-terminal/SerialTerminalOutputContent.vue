<script setup lang="ts">
import { useElementVisibility } from '@vueuse/core'
import { injectScrollAreaRootContext } from 'reka-ui'
import { computed, useTemplateRef, type HTMLAttributes } from 'vue'
import type { TerminalLineEntry } from './useTerminalOutput'

export interface ContentProps {
  entries?: readonly TerminalLineEntry[]
  class?: HTMLAttributes['class']
}

const props = defineProps<ContentProps>()
const scrollContext = injectScrollAreaRootContext()
const visibilityElement = useTemplateRef('visibilityElement')
const viewportElement = computed(() => {
  return scrollContext.viewport.value
})

const isVisibilityElementVisible = useElementVisibility(visibilityElement, {
  scrollTarget: viewportElement,
  // rootMargin: '50% '.repeat(4),
})

function scrollToBottom() {
  if (!isVisibilityElementVisible.value)
    return

  viewportElement.value?.scrollTo({
    top: Number.MAX_SAFE_INTEGER,
  })
}

watch(() => props.entries, () => {
  scrollToBottom()
}, {
  flush: 'post',
  deep: 2,
})

</script>

<template>
  <template
    v-for="entry in entries"
    :key="entry.id"
  >
    <slot :entry />
  </template>

  <div ref="visibilityElement" class="relative bottom-0" />
</template>
