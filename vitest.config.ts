import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  // vite 5 的内置模块列表还没有 node:sqlite，声明为外部依赖按原样保留
  ssr: { external: ['node:sqlite'] },
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    reporters: 'dot',
    server: { deps: { external: ['node:sqlite'] } }
  }
})
