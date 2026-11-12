import { defineConfig } from 'vitest/config'

export default defineConfig({
  // vite 5 的内置模块列表还没有 node:sqlite，声明为外部依赖按原样保留
  ssr: { external: ['node:sqlite'] },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    reporters: 'dot',
    server: { deps: { external: ['node:sqlite'] } }
  }
})
