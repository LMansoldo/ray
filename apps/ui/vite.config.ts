import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

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
})
