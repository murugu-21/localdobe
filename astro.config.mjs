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
        globIgnores: ['wasm/**', 'models/**'],
        // pdfcpu.wasm and ort wasm files cache on first use so most visitors never download them.
        runtimeCaching: [
          {
            urlPattern: /\/wasm\/.*\.(wasm|mjs)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'pdfcpu-wasm', expiration: { maxEntries: 8 } },
          },
          {
            urlPattern: /\/models\/.*\.onnx$/,
            handler: 'CacheFirst',
            options: { cacheName: 'onnx-models', expiration: { maxEntries: 4 } },
          },
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: null,
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    // onnxruntime-web's default export bundles its wasm binaries as `_astro/`
    // assets via `new URL(..., import.meta.url)` (the largest, the JSEP
    // variant, is 26.8MB — well past the PWA precache limit below, and Vite
    // treats that as a fatal build error). We already self-host the real
    // wasm under public/wasm/ort/ and point onnxruntime-web there at runtime
    // via `ort.env.wasm.wasmPaths` (see src/workers/orientation.worker.ts), so
    // the bundled copy is dead weight. This condition selects onnxruntime-web's
    // non-bundled build, which has no static wasm reference for Vite to pick up.
    resolve: { conditions: ['onnxruntime-web-use-extern-wasm'] },
  },
});
