import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Same alias as the renderer in electron.vite.config.ts.
    alias: { '@': resolve('src/renderer/src') },
  },
  test: {
    environment: 'node',
    // Unit tests (no network) and integration tests (main's real modules against the local fake
    // server in tests/fake-server).
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    server: {
      deps: {
        // electron-store imports `electron`; inlining it lets the tests' `vi.mock('electron')`
        // reach it, so known hosts are stored in a temporary folder.
        inline: ['electron-store'],
      },
    },
  },
})
