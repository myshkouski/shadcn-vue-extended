import type { SerialTerminalTarget } from '@/components/ui/serial-terminal'

export interface TerminalTargetDevice extends SerialTerminalTarget {
  open: (...args: any[]) => Promise<void> | void
  close: () => Promise<void> | void
}
