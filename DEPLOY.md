# Deployment

localdobe.com is a static, client-side-only site (Astro build output) served from
Cloudflare Workers static assets, configured in `wrangler.jsonc`. Deploys run via
**Cloudflare's direct git integration (Workers Builds)** — Cloudflare clones the
repo and builds on every push to `main`. There is no GitHub Actions deploy job.

Note: `public/wasm/pdfcpu.wasm` (~20 MB) is tracked with **Git LFS**. The remote
you connect must host the LFS objects (GitHub LFS does this automatically on push),
and Cloudflare's build image ships `git-lfs`, so the clone materializes the real
file. Verify this after the first deploy (step 4 below).

## One-time manual setup (not automatable)

1. **Push the repo to GitHub** (or GitLab). Git LFS objects upload alongside the
   normal push (`git push` handles it; ensure `git lfs install` has run locally).
2. **Connect the repo in the Cloudflare dashboard**: Workers & Pages → Create →
   connect to the GitHub repo, branch `main`. Build settings:
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Root directory: `/` (wrangler reads `wrangler.jsonc`)
   No API token or secrets are needed — the git integration deploys with the
   account's own credentials.
3. **Point localdobe.com's DNS at Cloudflare** (add the domain to the account /
   update nameservers) so the custom domain route in `wrangler.jsonc`
   (`routes: [{ pattern: "localdobe.com", custom_domain: true }]`) can attach.
   The first successful deploy provisions the custom-domain binding automatically.
4. **Verify the LFS file deployed correctly**: after the first build,
   `curl -sI https://localdobe.com/wasm/pdfcpu.wasm | grep -i content-length`
   must report ~20 MB — if it's a few hundred bytes, the build cloned an LFS
   *pointer* instead of the object; prepend `git lfs pull && ` to the build
   command in the Cloudflare build settings and redeploy.

## Tests

Cloudflare's build runs `npm run build` only. Run `npm run check && npm test &&
npm run test:e2e` locally before pushing (or re-add a test-only GitHub Actions
workflow later if you want a remote gate).

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
