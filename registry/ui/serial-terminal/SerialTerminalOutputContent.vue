<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { TerminalLineEntry } from './useTerminalOutput'
import { injectScrollAreaRootContext } from 'reka-ui'
import { computed, onMounted } from 'vue'
import { useEventListener, watchImmediate, watchThrottled } from '@vueuse/core'

export interface ContentProps {
  /**
   * The lines of the buffer, oldest first: sealed lines, then the line
   * currently being written to as the last element, if any.
   */
  entries?: readonly TerminalLineEntry[]
  class?: HTMLAttributes['class']
  throttle?: number
}

const props = defineProps<ContentProps>()
const scrollContext = injectScrollAreaRootContext()
const viewport = computed(() => scrollContext.viewport.value)

function scrollToBottom() {
  viewport.value?.scrollTo({
    top: Number.MAX_SAFE_INTEGER,
    behavior: 'instant',
  })
}

// True when the next write should keep the new bottom in view. Sampled
// *before* new lines reach the DOM to avoid the race an observer creates.
const isFollowing = defineModel<boolean>('follow', { default: true })

useEventListener(viewport, ["scroll", "scrollend"], (event) => {
  if (event.target instanceof Element) {
    isFollowing.value = isViewportAtBottom(event.target)
  }
})

function isViewportAtBottom(el: Element): boolean {
  // Sub-pixel slack
  return el.scrollHeight - el.scrollTop - el.clientHeight < 1
}

const entriesHash = computed(() => {
  if (!props.entries) return ''
  return `${props.entries.length}-${props.entries.at(-1)?.byteLength ?? 0}-${props.entries.at(-1)?.id ?? null}`
})

watchImmediate(isFollowing, isFollowing => {
  if (isFollowing) {
    scrollToBottom()
  }
})

watchThrottled([entriesHash, isFollowing], ([_, following]) => {
  if (following) {
    scrollToBottom()
  }
}, {
  throttle: () => props.throttle ?? 40,
  trailing: true,
  immediate: true,
  flush: 'post'
})

onMounted(() => {
  if (viewport.value) {
    isFollowing.value = isViewportAtBottom(viewport.value)
  }
})
</script>

<template>
  <div
    v-for="entry in entries"
    :key="entry.id"
    v-memo="[entry.id, entry.byteLength]"
    class="px-4 first:mt-4 last:mb-4 hover:bg-accent/50"
  >
    <slot :entry />
  </div>
</template>
