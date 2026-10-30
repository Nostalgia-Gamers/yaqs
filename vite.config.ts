import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tauri expects a fixed dev port and serves dist/ in production.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'chrome120',
    // Flags load on demand as files; inlining 270 of them would bloat the bundle.
    assetsInlineLimit: (file) => (file.includes('flag-icons') ? false : undefined),
  },
})
