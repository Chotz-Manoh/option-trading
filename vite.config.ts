import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative asset paths so the same build works inside the Windows launcher,
// the Android app (Capacitor) and any static web host.
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? '1.9.0'),
    __UPDATE_REPO__: JSON.stringify(process.env.UPDATE_REPO ?? ''),
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
})
