// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import AstroPWA from '@vite-pwa/astro';
import posthog from '@posthog/rollup-plugin';

// PostHog source maps for error tracking. The plugin switches the production
// build to hidden source maps, injects the chunk-id comments PostHog's
// symbol-set lookup keys on, uploads chunks and maps, then deletes the .map
// files — nothing extra is served, and an upload that fails fails the build
// instead of deploying unmapped. Both values live in the Cloudflare build
// variables (see DEPLOY.md); without them local builds stay map-free.
const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY?.trim();
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID?.trim();

export default defineConfig({
  // Canonical origin for sitemap, canonical tags and Open Graph URLs. Self-hosted
  // copies override it at build time (see Dockerfile and SELF-HOSTING.md).
  site: process.env.SITE_URL?.trim() || 'https://localdobe.com',
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
        // Precache the app shell: pages, JS, CSS, fonts, images, and the remaining
        // small assets. The 4.4MB pdfium.wasm (bundled into _astro/ via `?url`) and the
        // 1.3MB pdf.worker.min.mjs are excluded below — they are only needed once a PDF
        // is opened (pdfium for edit-pdf exports, the worker for any page render), so
        // they load on first use instead of on the first visit to any page. The 20MB
        // pdfcpu.wasm lives under /wasm/ and is excluded too.
        globPatterns: ['**/*.{html,js,mjs,css,ttf,woff,woff2,svg,png,ico,txt,xml,webmanifest,wasm}'],
        globIgnores: ['wasm/**', 'models/**', '_astro/**/*.wasm', '_astro/pdf.worker.min.*.mjs'],
        // pdfium.wasm, the pdf.js worker, pdfcpu.wasm, and ort wasm files cache on first
        // use so most visitors never download them.
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
          {
            urlPattern: /\/_astro\/.*\.wasm$/,
            handler: 'CacheFirst',
            options: { cacheName: 'astro-wasm', expiration: { maxEntries: 8 } },
          },
          {
            urlPattern: /\/_astro\/pdf\.worker\..*\.mjs$/,
            handler: 'CacheFirst',
            options: { cacheName: 'astro-pdf-worker', expiration: { maxEntries: 4 } },
          },
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: null,
      },
    }),
  ],
  vite: {
    plugins: [
      tailwindcss(),
      // Source maps for PostHog's error tracking (see above). The host default
      // (us.i.posthog.com) matches the US project the SDK reports to.
      ...(POSTHOG_API_KEY && POSTHOG_PROJECT_ID
        ? [
            posthog({
              personalApiKey: POSTHOG_API_KEY,
              projectId: POSTHOG_PROJECT_ID,
              sourcemaps: { enabled: true, deleteAfterUpload: true },
            }),
          ]
        : []),
    ],
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
