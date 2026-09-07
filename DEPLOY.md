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

## Analytics (PostHog for events, Clarity for replays)

The two tools do different jobs and do not overlap:

- **PostHog** takes every product event. `src/lib/analytics.ts` — `track(event, props)` —
  sends to `window.posthog.capture` with properties intact. Nothing in that module throws,
  so a blocked analytics script can never break a tool. Never pass a file name, document
  text, or a password into an event; see the privacy note at the top of that file.
- **Clarity** does session replay and heatmaps, and nothing else. It receives **no**
  product events — `analytics.ts` never calls `window.clarity`.

The split is forced: PostHog cannot record sessions while `cookieless_mode: 'always'` is
set (see below), and giving that up would mean cookies and a consent banner. Clarity
records fine with no cookies at all, so it covers replay and PostHog covers events.

The cost of the split is that a PostHog event and a Clarity replay cannot be linked — you
cannot jump from "this run failed" to "watch that session". If that becomes a real
problem, the fix is to send Clarity a small number of tags (tool name, failure) purely so
replays are filterable, which would mean `analytics.ts` calling `window.clarity` again.

`src/components/posthog.astro` inlines the snippet **at build time** from
`PUBLIC_POSTHOG_PROJECT_TOKEN` and `PUBLIC_POSTHOG_HOST`. Because the site is static, a
runtime Worker variable does nothing — both must be set as Cloudflare **build** variables
(the Worker → Settings → Build → Variables and secrets). When either is unset no snippet
is emitted at all (and `astro dev` throws, to stop the misconfiguration going unnoticed).

Two properties of this setup silently drop events. Both are configured correctly as of
2026-09-07; check them first if the dashboard ever looks emptier than it should, because
neither failure is visible from the site:

- **`cookieless_mode: 'always'` requires "Cookieless server hash mode" enabled on the
  PostHog project** — Project Settings → **Web analytics**. PostHog's SDK reference is
  explicit: "Cookieless mode must also be enabled in your PostHog project settings,
  otherwise cookieless events are ignored." The site behaves normally and the dashboard
  stays empty. This is enabled.

  Identity in this mode is `hash(team_id, daily_salt, ip_address, user_agent, hostname)`,
  where the salt "changes daily which we delete once that day's events have been
  processed" — so there is no client-side identifier and no cross-day linkage.
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

### PostHog session recording is off, and cannot be turned on from the dashboard alone

Enabling session replay in the PostHog project has no effect while
`src/components/posthog.astro` sets `cookieless_mode: 'always'`. Replay needs a session
id, and posthog-js refuses to construct one in that mode — its SessionIdManager throws
`'SessionIdManager cannot be used with cookieless_mode="always"'`, and `sessionRecording`
is only wired up for `cookieless_mode: 'on_reject'`. Live traffic confirms it: the site
POSTs to `/e/` and `/i/v0/e/` and never to `/s/`, the replay endpoint.

**This limitation is undocumented.** It is absent from PostHog's cookieless tracking
docs, from the `cookieless_mode` SDK config reference, and from the session replay
troubleshooting page (which does not mention cookieless mode at all). It was established
here by reading the shipped `array.js` and watching production network traffic. Two
consequences: nothing in the dashboard warns you that enabling replay does nothing, and
because the behaviour is not a documented contract it could change in a future
posthog-js release — so re-check it rather than assuming, if replay ever matters.

Turning PostHog replay on therefore means giving up cookieless mode — cookies, a consent
story for EEA/UK/CH visitors, and real changes to `src/pages/privacy.astro` (§4 and §7
both state the site sets no cookies). Clarity is used for replay precisely so none of
that is necessary.

## Session replay (Microsoft Clarity)

The Clarity snippet in `src/layouts/Base.astro` is inlined **at build time** from
`PUBLIC_CLARITY_PROJECT_ID`; like the PostHog vars it must be a Cloudflare **build**
variable, and when unset no script is emitted at all.

- Tool work areas carry **both** `data-clarity-mask="true"` and `ph-no-capture`
  (`src/components/astro/ToolPageShell.astro`) so replays never capture file names,
  document text, or passwords. The Clarity attribute is load-bearing today; the PostHog
  class is defence in depth for the day someone drops cookieless mode. Keep both, and
  also set the project's masking mode to **Strict** in the Clarity dashboard.
- Clarity sets **no cookies**. It is loaded without a `clarity('consent')` call, so it
  runs cookieless everywhere — verified in a real browser: loading the site produces
  `POST j.clarity.ms/collect` payloads (a DOM snapshot plus incremental mutations) while
  setting zero cookies and writing nothing to local or session storage. The trade is that
  sessions cannot be stitched across page loads and returning visitors are not recognized.
- Note this contradicts what the privacy policy claimed before 2026-09-07 (that Clarity
  set `_clck`/`_clsk`). It does not, under this configuration. §5 and §7 now say so.

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
