/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the app from /<repo>/. Override with BASE_PATH for other hosts.
const base = process.env.BASE_PATH ?? '/deer/';

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'sniffer.user.js'],
      manifest: {
        name: 'DeerTune',
        short_name: 'DeerTune',
        description: 'Unofficial open-source configurator for DrunkDeer keyboards (WebHID).',
        theme_color: '#0d0d10',
        background_color: '#0d0d10',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,json}'] },
    }),
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
