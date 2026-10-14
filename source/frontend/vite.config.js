import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// dist/ gets embedded into the backend by tools/gen_assets.py. During
// `npm run dev`, /api/* proxies to a running backend so no rebuild is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.PROSPEROMGR_BACKEND || 'http://127.0.0.1:7070',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // CSS minifier folds our compat declarations back into unsupported shorthand.
    cssMinify: false,
    // Default target leaves ??=/||=/&&= untranspiled — a parse error on 4.xx firmware.
    target: 'safari13.1',
  },
})
