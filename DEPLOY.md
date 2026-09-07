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
   `curl -sI https://localdobe.com/wasm/pdfcpu-v4.wasm | grep -i content-length`
   must report ~20 MB — if it's a few hundred bytes, the build cloned an LFS
   *pointer* instead of the object; prepend `git lfs pull && ` to the build
   command in the Cloudflare build settings and redeploy.

## Analytics (PostHog + Microsoft Clarity)

Both sinks are fed from a single helper, `src/lib/analytics.ts` — `track(event, props)`
sends every event to `window.posthog.capture` *and* to `window.clarity` (as a smart
event plus string tags; numbers are bucketed on the way in because Clarity stores only
strings). Nothing in that module throws, so a blocked analytics script can never break
a tool. Never pass a file name, document text, or a password into an event; see the
privacy note at the top of that file.

### PostHog

`src/components/posthog.astro` inlines the snippet **at build time** from
`PUBLIC_POSTHOG_PROJECT_TOKEN` and `PUBLIC_POSTHOG_HOST` — same constraint as Clarity
below, they must be set as Cloudflare **build** variables, not runtime Worker vars.
When either is unset no snippet is emitted at all (and `astro dev` throws, to stop the
misconfiguration from going unnoticed).

Two properties of this setup silently drop events. Both are configured correctly as of
2026-09-07; check them first if the dashboard ever looks emptier than it should, because
neither failure is visible from the site:

- **`cookieless_mode: 'always'` requires "Cookieless server hash mode" enabled on the
  PostHog project** (Project settings → Autocapture & data capture). With the option off
  PostHog *rejects every event the site sends* — the site behaves normally and the
  dashboard stays empty. This is enabled.
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
       "properties":{"distinct_id":"$posthog_cookieless","$host":"localdobe.com",
                     "$raw_user_agent":"Mozilla/5.0"}}'
# => {"status":"Ok"}
```

Note that `{"status":"Ok"}` means *accepted for processing*, not *ingested* — a project
with cookieless server hash mode disabled returns Ok and then drops the event. Confirm in
PostHog's activity feed, not from the HTTP status.

One more red herring: `posthog.has_opted_out_capturing()` returns `true` on this site.
That is expected and harmless — with `cookieless_mode: 'always'`, `is_capturing()`
short-circuits to `true` and posthog-js ignores consent entirely ("Consent opt in/out is
not valid with cookieless_mode=\"always\" and will be ignored"). Do not add a consent
banner to try to fix it.

## Analytics (Microsoft Clarity)

The Clarity snippet in `src/layouts/Base.astro` is inlined **at build time** from
`PUBLIC_CLARITY_PROJECT_ID`. Because the site is static, a runtime Worker variable
does nothing — the variable must be present during `npm run build`:

- Cloudflare dashboard → the Worker → **Settings → Build → Variables and secrets** →
  add `PUBLIC_CLARITY_PROJECT_ID` = your Clarity project ID (from clarity.microsoft.com
  → project → Settings → Overview), then redeploy.
- When the variable is unset (e.g. local `npm run dev`/`npm run build`), no Clarity
  script is emitted at all.
- Clarity receives the same events as PostHog (see above) as smart events plus session
  tags, which is what makes a replay filterable by tool and outcome.
- Tool work areas are wrapped in `data-clarity-mask="true"`
  (`src/components/astro/ToolPageShell.astro`) so session replays never capture file
  names, document text, or tool inputs. Keep that attribute if the shell is refactored,
  and additionally set the project's masking mode to **Strict** in the Clarity dashboard
  (Settings → Masking) as a second layer.
- No consent banner is shipped: for EEA/UK/CH visitors Clarity receives no consent
  signal and runs in cookieless no-consent mode (degraded sessions/funnels there, by
  design). The privacy policy (`src/pages/privacy.astro` §4) documents all of this —
  update it if any of the above changes — PostHog is documented in §5 and Clarity in §4.

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
