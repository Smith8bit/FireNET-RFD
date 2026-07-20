import { defineConfig, loadEnv } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Dev-server proxy target. Reuses VITE_API_URL (see web/.env.development) so the
  // backend host lives in one place; falls back to the local FastAPI default.
  // Point it at a deployed API by setting VITE_API_URL in web/.env.local.
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_URL || 'http://localhost:8000'
  const wsTarget = apiTarget.replace(/^http/, 'ws')

  return {
    // served under https://<host>/firenet/ — assets resolve relative to this
    base: '/firenet',

    plugins: [
      react(),
      tailwindcss()
    ],

    server: {
      proxy: {
        '/auth': { target: apiTarget, changeOrigin: true },
        '/users': { target: apiTarget, changeOrigin: true },
        '/regions': { target: apiTarget, changeOrigin: true },
        '/fires': { target: apiTarget, changeOrigin: true },
        '/officers': { target: apiTarget, changeOrigin: true },
        '/audit': { target: apiTarget, changeOrigin: true },
        '/ws': { target: wsTarget, changeOrigin: true, ws: true },
      },
    },

    legacy: {
      inconsistentCjsInterop: true
    }
  }
})
