import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // three.js (~540 kB) is its own chunk, loaded only when a 3D map is shown.
    chunkSizeWarningLimit: 600,
  },
})
