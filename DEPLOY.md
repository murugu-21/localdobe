# Deployment

localdobe.com is a static, client-side-only site (Astro build output) served from
Cloudflare Workers static assets, configured in `wrangler.jsonc`. Deploys run
automatically via `.github/workflows/deploy.yml` on every push to `main`:
checkout → Node 22 (npm cache) → `npm ci` → `npm run check` → `npm test` →
`npm run build` → `npx wrangler deploy`.

## One-time manual setup (not automatable)

These steps must be done once, by hand, by someone with Cloudflare account access:

1. **Create a Cloudflare API token** with Workers Scripts "Edit" permission (and
   Account Settings "Read" if scoped narrowly) for the account that owns
   localdobe.com.
2. **Add it as a GitHub Actions repo secret** named `CLOUDFLARE_API_TOKEN`
   (Settings → Secrets and variables → Actions). The workflow reads it via
   `${{ secrets.CLOUDFLARE_API_TOKEN }}`.
3. **Point localdobe.com's DNS at Cloudflare** (add the domain to the Cloudflare
   account / update nameservers) so the custom domain route in `wrangler.jsonc`
   (`routes: [{ pattern: "localdobe.com", custom_domain: true }]`) can attach to it.
4. **First deploy creates the custom domain route.** Once the token secret and DNS
   are in place, the next push to `main` (or a manual `npx wrangler deploy` run
   locally with `CLOUDFLARE_API_TOKEN` set) will provision the `localdobe.com`
   custom domain binding automatically — no separate dashboard step needed.

## Local verification

```bash
npm run build
npx wrangler deploy --dry-run   # validates config without deploying
```

## Cache headers

`public/_headers` (copied to `dist/_headers` by the Astro build) sets long-lived
immutable caching for content-hashed/static assets (`/_astro/*`, `/wasm/*`,
`/fonts/*`) and `no-cache` for `/sw.js` and `/manifest.webmanifest` so PWA clients
always pick up new service worker versions. See `wasm/pdfcpu/README.md` for the
cache-busting procedure when rebuilding `pdfcpu.wasm`.
