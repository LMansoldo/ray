import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
// Config alinhada às convenções do Tauri 2 (ver core/tauri.conf.json:
// build.devUrl/frontendDist): porta fixa e estrita para que o core sempre
// encontre o dev server em http://localhost:1420.
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  resolve: {
    alias: [
      {
        // Exact match only: a bare 'svelte' import must always be the client
        // entry — this is a browser app, and under vitest the node-style
        // resolve conditions fall through to svelte's 'default' export
        // (index-server.js), where mount() does not exist, breaking
        // @testing-library/svelte renders. Subpaths like
        // 'svelte/internal/client' keep resolving through svelte's exports map.
        find: /^svelte$/,
        replacement: fileURLToPath(
          new URL('./node_modules/svelte/src/index-client.js', import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
