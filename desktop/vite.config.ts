import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const host = process.env.TAURI_DEV_HOST
const webUiStartedAt = process.env.VITE_BEYA_WEB_STARTED_AT || new Date().toISOString()
const webUiStartedAtMs = Date.parse(webUiStartedAt) || Date.now()
const webUiPort = Number(process.env.VITE_BEYA_WEB_PORT || '0') || null

function beyaWebUiStatus(): Plugin {
  return {
    name: 'beya-web-ui-status',
    configureServer(server) {
      server.middlewares.use('/__beya_web_ui_status', (_request, response) => {
        response.statusCode = 200
        response.setHeader('Access-Control-Allow-Origin', '*')
        response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({
          app: 'beya-desktop-web-ui',
          cwd: process.cwd(),
          serverUrl: process.env.VITE_DESKTOP_SERVER_URL || null,
          startedAt: webUiStartedAt,
          startedAtMs: webUiStartedAtMs,
          launchedByStartScript: Boolean(process.env.VITE_BEYA_WEB_STARTED_AT),
          webPort: webUiPort,
        }))
      })
    },
  }
}

export default defineConfig({
  plugins: [beyaWebUiStatus(), react(), tailwindcss()],
  build: {
    // Vite 8 defaults to baseline-widely-available (safari16.4+), which
    // requires macOS 13+. Tauri on macOS 12 uses Safari 15 WebView.
    target: ['es2021', 'safari15'],
    chunkSizeWarningLimit: 2200,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'INEFFECTIVE_DYNAMIC_IMPORT') return
        warn(warning)
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
