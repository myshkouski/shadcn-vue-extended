<script setup lang="ts">

import { reactiveOmit } from '@vueuse/core';
import { Primitive, useForwardProps, type PrimitiveProps } from 'reka-ui';
import { cn } from '~/lib/utils';
import type { TerminalLineEntry } from './useTerminalOutput';
import type { HTMLAttributes } from 'vue';

export interface SerialTerminalOutputLineProps extends PrimitiveProps {
  entry: TerminalLineEntry;
  class?: HTMLAttributes["class"];
}

const props = withDefaults(
  defineProps<SerialTerminalOutputLineProps>(),
  {
    "as": "p"
  }
);

const delegatedProps = reactiveOmit(props, ['entry', 'class'])

</script>

<template>

  <Primitive
    v-bind="delegatedProps"
    :class="cn(
      // 'whitespace-pre',
      'font-mono text-sm',
      props.entry.type === 'input' && 'text-primary',
      props.entry.type === 'system' && 'text-muted-foreground italic',
      props.entry.type === 'output' && 'text-foreground',
      props.class,
    )"
  >
    <span class="shrink-0 text-muted-foreground select-none">
      {{ entry.type === 'input' ? '$' : entry.type === 'output' ? '>' : '·' }}
    </span>
    {{ entry.content }}
  </Primitive>

</template>