<script setup lang="ts">
import { useElementVisibility } from '@vueuse/core'
import { injectScrollAreaRootContext } from 'reka-ui'
import { computed, useTemplateRef, watch, type HTMLAttributes } from 'vue'
import type { TerminalLineEntry } from './useTerminalOutput'

export interface ContentProps {
  entries?: Iterable<TerminalLineEntry>
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
    <div
      class="px-4 first:mt-4 hover:bg-accent/50"
    >
      <slot :entry />
    </div>
  </template>

  <div ref="visibilityElement" class="relative bottom-0 mb-4" />
</template>
