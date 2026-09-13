# Deployment

localdobe.com is a static, client-side-only site (Astro build output) served from
Cloudflare Workers static assets, configured in `wrangler.jsonc`. Deploys run via
**Cloudflare's direct git integration (Workers Builds)** — Cloudflare clones the
repo and builds on every push to `main`. There is no GitHub Actions deploy job.

Note: `public/wasm/pdfcpu-v4.wasm` (~20 MB) is tracked with **Git LFS**. The remote
you connect must host the LFS objects (GitHub LFS does this automatically on push),
and Cloudflare's build image ships `git-lfs`, so the clone materializes the real
file. Verify this after the first deploy (step 4 below).

## One-time manual setup (not automatable)

1. **Push the repo to GitHub** (or GitLab). Git LFS objects upload alongside the
   normal push (`git push` handles it; ensure `git lfs install` has run locally).
2. **Connect the repo in the Cloudflare dashboard**: Workers & Pages → Create →
   connect to the GitHub repo, branch `main`. Build settings:
   - Build command: `bun run build`
   - Deploy command: `bunx wrangler deploy`
   - Root directory: `/` (wrangler reads `wrangler.jsonc`)
   - Build variable `BUN_VERSION=1.3.11` — the build image ships Bun 1.2.x by
     default; Cloudflare auto-installs dependencies from `bun.lock`.
   No API token or secrets are needed — the git integration deploys with the
   account's own credentials.
3. **Point localdobe.com's DNS at Cloudflare** (add the domain to the account /
   update nameservers) so the custom domain route in `wrangler.jsonc`
   (`routes: [{ pattern: "localdobe.com", custom_domain: true }]`) can attach.
   The first successful deploy provisions the custom-domain binding automatically.
4. **Verify the LFS file deployed correctly**: after the first build,
   `curl -sI https://localdobe.com/wasm/pdfcpu-v4.wasm | grep -i content-length`
   must report ~20 MB — if it's a few hundred bytes, the build cloned an LFS
   *pointer* instead of the object; prepend `git lfs pull && ` to the build
   command in the Cloudflare build settings and redeploy.

## Analytics (PostHog for events and session replay)

PostHog does both jobs, so a session in the dashboard links the two:

- **Product events.** `src/lib/analytics.ts` — `track(event, props)` — sends to
  `window.posthog.capture` with properties intact. Nothing in that module throws, so a
  blocked analytics script can never break a tool. Never pass a file name, document text,
  or a password into an event; see the privacy note at the top of that file.
- **Session replay.** `src/components/posthog.astro` enables recording with masking. Tool
  work areas carry `ph-no-capture` (`src/components/astro/ToolPageShell.astro`), which is
  PostHog's default `blockClass` — the element and its subtree are replaced by a
  placeholder in the replay — and `maskAllInputs` is pinned in the config so typed values
  stay masked regardless of the project's dashboard masking mode. Keep all of that, and
  set the project's masking mode to **Strict** as well.

Replay needs a session id, and posthog-js refuses to build one in cookieless mode, so the
config uses the default `localStorage+cookie` persistence: the site sets one first-party
PostHog cookie plus a `localStorage` entry, disclosed in `src/pages/privacy.astro` §4 and
§5. This replaced Microsoft Clarity on 2026-09-13 — Clarity managed replay with no
cookies at all, but its replays could not be linked to PostHog events or filtered by them.

`src/components/posthog.astro` inlines the snippet **at build time** from
`PUBLIC_POSTHOG_PROJECT_TOKEN` and `PUBLIC_POSTHOG_HOST`. Because the site is static, a
runtime Worker variable does nothing — both must be set as Cloudflare **build** variables
(the Worker → Settings → Build → Variables and secrets). When either is unset no snippet
is emitted at all (and `astro dev` throws, to stop the misconfiguration going unnoticed).

**Error stack traces are de-minified by source map upload.** The production build runs
`@posthog/rollup-plugin` (`astro.config.mjs`), enabled only when `POSTHOG_API_KEY` (a
personal API key with error-tracking write) and `POSTHOG_PROJECT_ID` are set — add both
to the same Cloudflare **build** variables as the snippet above. They must *not* carry a
`PUBLIC_` prefix: that would inline the key into client code. When on, the plugin emits
hidden source maps, injects a chunk-id comment into every JS chunk, uploads chunks and
maps to the project, then deletes the `.map` files before deploy, so nothing extra is
served — and a failed upload fails the build rather than deploying without maps. Without
the two variables (local builds, `astro dev`) the plugin is absent and the build is
unchanged.

Session replay has a second switch that is not in this repo: the PostHog project's
**Record user sessions** setting. The SDK config only controls masking; if replays are
missing, check that toggle first.

One property of this setup silently drops events. It is configured correctly as of
2026-09-07; check it first if the dashboard ever looks emptier than it should, because the
failure is not visible from the site:

- **Ad-blockers stop `us.i.posthog.com` outright** — uBlock Origin, Brave, and Safari's
  built-in protection all carry it, which for a developer-leaning audience is a large and
  non-random share of traffic. `PUBLIC_POSTHOG_HOST` therefore points at
  **`https://e.localdobe.com`**, a PostHog *managed reverse proxy*: a CNAME from
  `e.localdobe.com` to `…cf-prod-us-proxy.proxyhog.com`, with PostHog terminating TLS via
  Cloudflare for SaaS. Because the hostname is a subdomain of the site's own domain,
  blocklists don't match it.

  Notes on that CNAME, learned setting it up:
  - It must stay **DNS-only (grey cloud)** in Cloudflare. Proxying it (orange cloud)
    makes Cloudflare refuse the cross-account CNAME.
  - Provisioning is not instant. Until PostHog finishes registering the custom hostname,
    every path returns **HTTP 403 with `error code: 1014`** ("CNAME Cross-User Banned").
    That resolves on its own within minutes — don't re-point DNS in response to it.
  - Verify it end to end before trusting it, since a broken proxy loses *all* analytics
    rather than merely some:

    ```bash
    curl -sS -o /dev/null -w '%{http_code}\n' https://e.localdobe.com/static/array.js   # 200, ~282 KB
    curl -sS -o /dev/null -X OPTIONS -H 'Origin: https://localdobe.com' \
      -H 'Access-Control-Request-Method: POST' \
      -w '%{http_code}\n' https://e.localdobe.com/i/v0/e/                              # 200
    ```

  Changing this host means updating `PUBLIC_POSTHOG_HOST` in the Cloudflare build
  variables *and* `.env` — it is inlined at build time, so a redeploy is required.

**Do not try to verify PostHog with a headless browser.** posthog-js drops bot traffic
inside `capture()`, before it logs anything or touches the network, and its bot check
ends in `return !!navigator.webdriver` — with a `navigator.userAgentData.brands` check
just above it. Any WebDriver-driven browser (Playwright, Puppeteer, Selenium) therefore
sends *zero* events while `is_capturing()` still reports `true` and debug mode prints
nothing, which looks exactly like a broken integration. Overriding the user agent does
not help; `userAgentData` still says HeadlessChrome. Verify with a raw POST instead:

```bash
curl -sS -X POST https://e.localdobe.com/i/v0/e/ -H 'Content-Type: application/json' \
  -d '{"api_key":"<PUBLIC_POSTHOG_PROJECT_TOKEN>","event":"proxy_check",
       "properties":{"distinct_id":"proxy_check","$host":"localdobe.com",
                     "$raw_user_agent":"Mozilla/5.0"}}'
# => {"status":"Ok"}
```

Note that `{"status":"Ok"}` means *accepted for processing*, not *ingested*. Confirm in
PostHog's activity feed, not from the HTTP status.

### Cookies and consent

Dropping cookieless mode means the site sets a cookie, which for EEA/UK/CH visitors is
the kind of thing that normally requires a consent banner. There is deliberately no banner
yet: the site runs PostHog unconditionally and `src/pages/privacy.astro` (§4 and §6)
discloses the cookie rather than gating it. If a gate is ever needed, the pieces are
`opt_out_capturing_by_default: true` in the init config plus a banner calling
`posthog.opt_in_capturing()` — replay will not start until the visitor opts in.

## Tests

Cloudflare's build runs `bun run build` only. Run `bun run check && bun run test &&
bun run test:e2e` locally before pushing (or re-add a test-only GitHub Actions
workflow later if you want a remote gate).

## Local verification

```bash
bun run build
bunx wrangler deploy --dry-run   # validates config without deploying
```

## Cache headers

`public/_headers` (copied to `dist/_headers` by the Astro build) sets long-lived
immutable caching for content-hashed/static assets (`/_astro/*`, `/wasm/*`,
`/fonts/*`) and `no-cache` for `/sw.js` and `/manifest.webmanifest` so PWA clients
always pick up new service worker versions. See `wasm/pdfcpu/README.md` for the
cache-busting procedure when rebuilding `pdfcpu.wasm`.
