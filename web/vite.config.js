import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // served under https://<host>/firenet/ — assets resolve relative to this
  base: '/firenet/',

  plugins: [
    react(),
    tailwindcss()
  ],
  
  server: {
    proxy: {
      '/auth': { target: 'https://wildfire.forest.go.th/firenet/api', changeOrigin: true },
      '/users': { target: 'https://wildfire.forest.go.th/firenet/api', changeOrigin: true },
      '/regions': { target: 'https://wildfire.forest.go.th/firenet/api', changeOrigin: true },
      '/fires': { target: 'https://wildfire.forest.go.th/firenet/api', changeOrigin: true },
      '/officers': { target: 'https://wildfire.forest.go.th/firenet/api', changeOrigin: true },
      '/audit': { target: 'https://wildfire.forest.go.th/firenet/api', changeOrigin: true },
      '/ws': { target: 'wss://wildfire.forest.go.th/firenet/api', changeOrigin: true, ws: true },
    },
  },

  legacy: {
    inconsistentCjsInterop: true
  }
})
