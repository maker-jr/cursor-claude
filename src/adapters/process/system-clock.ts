import type { Clock } from '../../ports/clock'

export const systemClock: Clock = {
  now: () => Date.now(),
}
