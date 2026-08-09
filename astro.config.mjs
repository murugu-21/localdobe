// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import AstroPWA from '@vite-pwa/astro';

export default defineConfig({
  site: 'https://localdobe.com',
  integrations: [
    react(),
    sitemap(),
    AstroPWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'localdobe — local PDF tools',
        short_name: 'localdobe',
        description:
          'Merge, split, compress, edit, watermark, and protect PDFs — entirely on your device.',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globDirectory: 'dist',
        // Precache the app shell: pages, JS, CSS, fonts, images, and small hashed wasm
        // assets (e.g. the ~4.6MB pdfium.wasm bundled via `?url` import into _astro/) —
        // NOT the 20MB pdfcpu.wasm, which lives under /wasm/ and is excluded below.
        globPatterns: ['**/*.{html,js,mjs,css,ttf,woff,woff2,svg,png,ico,txt,xml,webmanifest,wasm}'],
        globIgnores: ['wasm/**'],
        // pdfcpu.wasm caches on first use so most visitors never download it.
        runtimeCaching: [
          {
            urlPattern: /\/wasm\/.*\.wasm$/,
            handler: 'CacheFirst',
            options: { cacheName: 'pdfcpu-wasm', expiration: { maxEntries: 4 } },
          },
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: null,
      },
    }),
  ],
  vite: { plugins: [tailwindcss()] },
});
