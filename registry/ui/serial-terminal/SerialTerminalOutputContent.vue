<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { TerminalLineEntry } from './useTerminalOutput'
import { injectScrollAreaRootContext } from 'reka-ui'
import { computed, onMounted, shallowRef } from 'vue'
import { watchImmediate } from '@vueuse/core'

export interface ContentProps {
  /**
   * The lines of the buffer, oldest first: sealed lines, then the line
   * currently being written to as the last element, if any.
   */
  entries?: readonly TerminalLineEntry[]
  class?: HTMLAttributes['class']
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
const isFollowing = shallowRef(true)

function isViewportAtBottom(): boolean {
  const el = viewport.value
  if (!el)
    return isFollowing.value
  // Sub-pixel slack
  const res = el.scrollHeight - el.scrollTop - el.clientHeight
  // console.debug("!", res, el.scrollHeight, el.scrollTop, el.clientHeight)
  return res < 1
}

const entriesHash = computed(() => {
  if (!props.entries) return -1
  return `${props.entries.length}-${props.entries.at(-1)?.byteLength ?? 0}-${props.entries.at(-1)?.id ?? null}`
})

// Decide whether to follow *before* the patch...
watchImmediate(entriesHash, () => {
  isFollowing.value = isViewportAtBottom()
}, { flush: 'pre' })

// ...and only scroll *after* the patch.
watchImmediate([entriesHash, isFollowing], ([entriesHash, following]) => {
  if (following)
    scrollToBottom()
}, { flush: 'post' })

onMounted(() => {
  isFollowing.value = isViewportAtBottom()
  scrollToBottom()
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
