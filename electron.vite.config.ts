import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      // electron-store is ESM-only; bundle it into the CommonJS main output.
      externalizeDeps: { exclude: ['electron-store'] },
    },
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
      },
    },
    plugins: [react(), tailwindcss()],
    // noVNC ships native ES modules with top-level await; skip dev pre-bundling.
    optimizeDeps: { exclude: ['@novnc/novnc'] },
  },
})
