<script setup lang="ts">
import type { ScrollAreaRootProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import SerialTerminalOutputContent from "./SerialTerminalOutputContent.vue"
import { cn } from "~/lib/utils.ts";

const props = defineProps<ScrollAreaRootProps & { class?: HTMLAttributes["class"] }>()

const content = useTemplateRef("content")

defineExpose({
  scrollToBottom: () => content.value?.scrollToBottom()
})

</script>

<template>
  <ScrollArea
    :class="cn(
      'flex-1 h-full overflow-hidden p-4', props.class
    )"
  >
      <SerialTerminalOutputContent ref="content">
        <slot />
      </SerialTerminalOutputContent>
    </ScrollArea>
</template>
