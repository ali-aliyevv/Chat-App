import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Precache only the built app shell (JS/CSS/HTML/icons) so the app
      // installs and launches instantly offline. Chat data, uploads, and
      // the socket connection are never cached here — they're deliberately
      // left to the network so nothing stale is ever shown.
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//, /^\/socket\.io\//],
      },
      manifest: {
        name: 'RealChat',
        short_name: 'RealChat',
        description: 'Real-time chat with voice/video calls',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0a0d17',
        theme_color: '#ff3d00',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
