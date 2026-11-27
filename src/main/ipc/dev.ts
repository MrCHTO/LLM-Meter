import { seed } from '../dev/seed'
import { handle, wrap } from './shared'

export function register(): void {
  handle(
    'devSeed',
    wrap((count: number) => seed(count))
  )
}
