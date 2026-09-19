# Self-hosting localdobe

localdobe is a static site. The build produces a folder of HTML, JS, CSS, fonts and
WebAssembly files, and every tool runs in the visitor's browser. Hosting it yourself means
serving that folder from any web server. There is no backend, no database, no server-side
code, and no outbound request from the site unless you configure analytics.

localdobe.com itself deploys to Cloudflare Workers via git integration; that setup is in
[`DEPLOY.md`](DEPLOY.md). This page covers hosting on anything else.

## Quickest: Docker

The repo ships a multi-stage `Dockerfile` that builds the site with Bun and serves it with
nginx, using the headers described further down. The final image is about 50 MB.

```bash
git lfs install
git clone https://github.com/murugu-21/localdobe.git
cd localdobe
docker build --build-arg SITE_URL=https://pdf.example.com -t localdobe .
docker run -d --restart unless-stopped -p 8080:80 localdobe   # http://localhost:8080/
```

Or with Compose, after editing `SITE_URL` in `docker-compose.yml`:

```bash
docker compose up -d --build
```

`SITE_URL` is the origin baked into canonical tags, the sitemap and Open Graph URLs. Leave it
out and the pages advertise localdobe.com. The build refuses to run on a checkout where the
Git LFS files are still pointers, so a missing `git lfs install` fails fast instead of shipping
a site whose tools break at runtime.

Put your usual TLS-terminating proxy in front. The container listens on port 80, sends
relative redirects, and has a health check on `/`.

## Requirements

- **Git with Git LFS** (`git lfs install`). The pdfcpu WebAssembly engine, the ONNX runtime
  and the page-orientation model are stored in LFS. Without LFS you get a few-hundred-byte
  pointer file instead of the real asset, and the compress, watermark, signature, protect,
  unlock and rotate tools fail at runtime.
- **Bun ≥ 1.3** for the build (`bun.lock` is the lockfile). Node ≥ 24 is pinned in `.nvmrc`
  for tooling that shells out to Node.
- **Any static file server**: nginx, Caddy, Apache, Netlify, Vercel, GitHub Pages, S3 + CDN,
  or a plain `python3 -m http.server` for a quick test.
- About 75 MB of disk for the build output. Most of that is WebAssembly engines and the
  orientation model, which visitors download once on first use and then keep in the browser
  cache.

## Build

```bash
git lfs install
git clone https://github.com/murugu-21/localdobe.git
cd localdobe
bun install
bun run build          # writes the site to dist/
```

Check that LFS materialised the real files before deploying:

```bash
ls -l dist/wasm/pdfcpu-v4.wasm dist/models/doc-ori.onnx
# pdfcpu-v4.wasm should be ~21 MB and doc-ori.onnx ~6.8 MB.
# If either is a few hundred bytes, run `git lfs pull` and rebuild.
```

Quick local check:

```bash
python3 -m http.server -d dist 8080     # then open http://localhost:8080/
```

## Before you build: things that point at localdobe.com

The defaults are for the public instance. Change these so your copy doesn't advertise
someone else's domain:

| What | Where | Why |
| --- | --- | --- |
| `SITE_URL` | Environment variable at build time (`SITE_URL=https://pdf.example.com bun run build`, or the Docker build arg) | Canonical tags, sitemap, RSS and Open Graph URLs are built from it. Defaults to `https://localdobe.com`. |
| `Sitemap:` line | `public/robots.txt` | Hardcoded to `https://localdobe.com/sitemap-index.xml`. |
| PWA `name` / `short_name` | `astro.config.mjs` (the `AstroPWA` block) | What the installed app is called. |
| Support email and repo links | `src/layouts/Base.astro`, `src/pages/about.astro`, `src/pages/privacy.astro` | Footer and trust pages. |

## Analytics

Analytics is opt-in at build time. The site reads two variables from `.env` (see
`.env.example`); when they are absent the build succeeds, no analytics script ships, and the
site sets no cookie. That is the right default for a private instance.

If you do want PostHog, copy `.env.example` to `.env` and set:

```bash
PUBLIC_POSTHOG_PROJECT_TOKEN=phc_...       # your project token
PUBLIC_POSTHOG_HOST=https://us.i.posthog.com   # or your own proxy; the default in .env.example is localdobe's
```

Both are inlined into the HTML at build time, so a change needs a rebuild. `src/pages/privacy.astro`
describes the public instance's analytics; update it if yours differs.

## Serving

The build uses one folder per page (`dist/split-pdf/index.html`), so the server must serve
`index.html` for directory requests. All common servers do this by default.

Two things matter for correctness. The service worker (`/sw.js`) and the web manifest must
not be cached long-term, or visitors keep running an old version after you deploy. The hashed
assets under `/_astro/`, `/wasm/` and `/fonts/` can be cached for a year. `public/_headers`
expresses this in the format Cloudflare and Netlify read natively; on other servers, replicate
it as below. The Docker image already does, via `docker/nginx.conf`.

### nginx

The `map` block goes in the `http` context, the `server` block wherever your sites live.
Using a `map` keeps every header in one place, which avoids nginx's rule that an `add_header`
inside a `location` discards the ones declared above it.

```nginx
map $uri $localdobe_cache {
    ~^/(_astro|wasm|fonts)/              "public, max-age=31536000, immutable";
    ~^/(sw\.js|manifest\.webmanifest)$   "no-cache";
    default                              "";
}

server {
    listen 80;
    server_name pdf.example.com;
    root /var/www/localdobe/dist;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    add_header Cache-Control $localdobe_cache;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy strict-origin-when-cross-origin;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml text/plain application/xml;
}
```

nginx ≥ 1.21 already maps `.wasm` to `application/wasm`. On older versions add
`types { application/wasm wasm; }`; browsers refuse to stream-compile WebAssembly served
with the wrong type.

### Caddy

```caddyfile
pdf.example.com {
    root * /srv/localdobe/dist
    encode zstd gzip
    file_server

    @immutable path /_astro/* /wasm/* /fonts/*
    header @immutable Cache-Control "public, max-age=31536000, immutable"

    @volatile path /sw.js /manifest.webmanifest
    header @volatile Cache-Control "no-cache"

    header X-Content-Type-Options nosniff
    header Referrer-Policy strict-origin-when-cross-origin
}
```

Caddy provisions TLS automatically for a public hostname.

### Netlify, Vercel, GitHub Pages, S3

Upload `dist/`. Netlify reads `dist/_headers` as-is. On the others, set the two cache rules
above in the platform's headers configuration if it has one; the site still works without
them, but visitors may see a stale service worker for up to the CDN's default TTL after an
update.

## Updating

```bash
git pull
git lfs pull
bun install
bun run build
# redeploy dist/
```

With Docker: `git pull && git lfs pull && docker compose up -d --build`.

Because `sw.js` is served with `no-cache`, browsers that already have the old service worker
pick up the new build on their next visit and swap to it on the following page load.

## What the site does at runtime

For anyone auditing a self-hosted copy:

- No request leaves the visitor's browser except to your own server for the site's files,
  and to PostHog if you configured it.
- PDFs are processed in memory with pdf-lib, pdf.js and pdfcpu compiled to WebAssembly. They
  are never posted anywhere.
- After the first visit the service worker precaches the app shell, and each WebAssembly
  engine is cached the first time a tool needs it. From then on the whole site works with no
  network connection.
