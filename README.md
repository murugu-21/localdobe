# localdobe

Free PDF tools that run entirely in your browser. Merge, split, compress, edit, watermark/stamp,
check-or-remove signatures, and password-protect/unlock PDFs — no file is ever uploaded to a
server. localdobe.com is a static site; every tool executes client-side and works offline once
you've visited it.

## Documentation

- [`SEO-STRATEGY.md`](SEO-STRATEGY.md) — keyword/GEO strategy, page→keyword mapping, intent traps, and the technical SEO foundation (trailing-slash canonicals, sitemap, schema).
- [`DEPLOY.md`](DEPLOY.md) — deployment via Cloudflare Workers Builds (push to `main`).

## Tools

| Tool | Page | What it does |
| --- | --- | --- |
| Merge | `/merge-pdf` | Combine multiple PDFs into one, reorder pages first |
| Split | `/split-pdf` | Extract page ranges into separate PDFs, zipped client-side |
| Compress | `/compress-pdf` | Shrink file size via pdfcpu (Light / Balanced / Maximum presets) |
| Edit | `/edit-pdf` | Click-to-edit text in place, rotate and resize pages |
| Watermark & Stamp | `/watermark-pdf` | Add a text/image watermark or stamp; remove existing ones |
| Signatures | `/validate-pdf-signature` | Validate digital signatures, inspect evidence, or remove them |
| Protect | `/protect-pdf` | Encrypt a PDF with AES-256 |
| Unlock | `/unlock-pdf` | Remove a password you already know |

Plus a 14-post blog (`/blog`) and trust pages (`/about`, `/privacy`).

## Local development

```bash
npm install
npm run dev        # http://localhost:4321
```

Requires Node ≥ 22.12 (see `.nvmrc` — pinned to `22`).

## Tests

```bash
npm run check       # astro check + tsc --noEmit
npm test            # vitest (unit tests, 42 tests across 9 files)
npm run test:watch  # vitest in watch mode
npm run test:e2e    # playwright, drives real tool flows end-to-end (7 tests)
npm run build       # production build to dist/
npm run preview     # serve the dist/ build locally, for e2e/PWA/Lighthouse checks
```

`npm run test:e2e` builds and serves the site itself — `playwright.config.ts`'s `webServer`
runs `npm run build && npm run preview` before the suite starts (reusing an already-running
preview server outside CI), so it always exercises a fresh production build.

There is no CI test job — run `npm run check && npm test && npm run test:e2e` locally before
pushing (deploys are handled by Cloudflare's git integration, which only runs the build).

## Architecture

```
Astro 5 static build (SSG, no server at runtime)
├─ .astro pages/layouts — shell, SEO tags, JSON-LD, content (landing, tool pages, blog)
├─ React islands (client:load) — one per tool (MergeTool, SplitTool, CompressTool, EditTool,
│  WatermarkTool, SignatureTool, ProtectTool, UnlockTool), built with shadcn/ui components
├─ src/lib/pdf/* — tool logic: pdf-lib for merge/split/edit/render, pdfjs-dist v6 for thumbnails
│  and text extraction, thin client wrappers (pdfcpuClient.ts) around the worker below
├─ src/workers/pdfcpu.worker.ts — a Web Worker hosting pdfcpu (Go) compiled to WebAssembly
│  (public/wasm/pdfcpu.wasm, ~20 MB, committed as a build artifact — see wasm/pdfcpu/README.md).
│  Handles optimize/compress, watermark/stamp, signature validate+remove, and encrypt/decrypt.
│  Runs off the main thread so large PDFs don't freeze the UI.
└─ PWA offline layer (@vite-pwa/astro / Workbox) — service worker precaches the entire static
   app shell (HTML, JS, CSS, fonts, images) at install time; pdfcpu.wasm is deliberately
   excluded from precache (too large for most visitors to download unasked) and instead
   uses a CacheFirst runtime-caching rule, so it's fetched once on first tool use and served
   from cache — including fully offline — afterwards. Result: every page and every tool works
   with no network connection after one visit; the site is installable as an app.
```

Fonts: the site UI uses a self-hosted variable font (Geist, via `@fontsource-variable/geist`).
PDF editing (the Edit tool) embeds **Liberation Sans/Serif/Mono** into exported PDFs so edited
text renders consistently regardless of what's installed on the reader's machine — see
`public/fonts/LICENSE-liberation.txt` (SIL Open Font License 1.1; free to embed, bundle, and
redistribute with the PDFs it produces).

## Rebuilding the pdfcpu WASM engine

The compiled `public/wasm/pdfcpu.wasm` and its `wasm_exec.js` runtime are committed so CI and
the Cloudflare deploy never need a Go toolchain. You only need to rebuild when bumping the
pdfcpu version — see `wasm/pdfcpu/README.md` for the pinned version, the exported JS globals,
and (important) the cache-busting procedure: `pdfcpu.wasm` is served with a 1-year immutable
cache header and is *not* content-hashed, so overwriting it in place won't bust caches for
existing visitors — rename the file and update the fetch URL instead.

```bash
cd wasm/pdfcpu
go mod tidy   # only if bumping the pdfcpu version
make build
node smoke.mjs
```

## Deploying

localdobe.com deploys to Cloudflare Workers static assets (`wrangler.jsonc`) via Cloudflare's
direct git integration (Workers Builds) on every push to `main`. Note that `public/wasm/pdfcpu.wasm`
is tracked with Git LFS. One-time manual setup (connecting the repo in the Cloudflare dashboard, DNS)
is required before the first deploy — see **`DEPLOY.md`** for the full checklist and cache-header
details (`public/_headers`).

## Stack

Astro 5, React 19 islands, Tailwind CSS v4, shadcn/ui, pdf-lib, pdfjs-dist v6, pdfcpu v0.14.0
(compiled to WASM), Vitest, Playwright, `@vite-pwa/astro`, deployed on Cloudflare Workers.
