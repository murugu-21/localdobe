# localdobe.com — SEO & GEO Strategy

Living document for how localdobe.com grows organic search visibility (rankings/clicks)
and stays visible in generative / agentic search. Keep this in sync whenever content,
schemata, or targeting changes.

## Goals (in priority order)

1. Increase organic rankings & clicks (Search Console impressions / CTR / position).
2. Stay visible in AI/generative answers and stay resilient to AI click-loss (GEO).
3. Increase retention once visitors land (Clarity: engaged sessions, low pogo-sticking).

## How the site earns search traffic (the model)

localdobe is a **free, single-purpose, in-browser PDF tool site**. This maps 1:1 onto
Ahrefs' *Free Tools SEO Strategy* playbook, which is the closest-published methodology:

- **Searchers on PDF-tool queries want to *do*, not read.** The free-tool SERPs dominate,
  tool intent is the primary intent, and a focused tool page wins those SERPs.
- **Tools are the most AI-summarize-proof content.** A tool is much harder for Google or an
  AI answer to "summarize out of existence" than an informational article — they stay
  resilient even as AI Overviews eat click-through.
- **We chase the *winnable* tier, not head terms.** Head terms ("compress pdf", "split pdf")
  carry big volume at KD 60–90 against billion-visit competitors. The winnable pool sits one
  level down: **KD ≤ ~30 long-tails where low-authority / single-purpose tool pages already rank.**

## Keywords (shortlist) → page mapping

One tool page captures its whole long-tail cluster via visible FAQ + `FAQPage` schema.
| Page | Head term (long-term) | Winnable terms to own now (in FAQ / copy) |
|---|---|---|
| `/split-pdf/` | split pdf | split pdf into separate pages, split pdf into pages, extract pages from pdf, split pdf by range/page numbers, split pdf without uploading |
| `/compress-pdf/` | compress pdf | **compress pdf without losing quality**, compress pdf to a specific size, compress pdf for email |
| `/merge-pdf/` | merge pdf | merge pdf / combine pdf without uploading, combine pdf with jpg/png |
| `/unlock-pdf/` | unlock pdf | **remove pdf password online (your own file, with the password)** |
| `/protect-pdf/` | password protect pdf | add a password to a pdf, encrypt pdf (AES-256) |
| `/watermark-pdf/` | add watermark to pdf | add a text watermark to a pdf, add watermark online free |
| `/validate-pdf-signature/` | validate pdf signature | validate pdf signature online, pdf signature verification, check pdf signature |
| `/edit-pdf/` | edit pdf | edit pdf without signing up, edit text in pdf, edit pdf no signup |

Split + compress are the current traffic leaders and the highest-ROI clusters (see changelog).

### Programmatic size pages (compress)

`/compress-pdf/to-{100kb,200kb,500kb,1mb,2mb,5mb}/` are generated at build time by
`getStaticPaths()` in `src/pages/compress-pdf/[size].astro` — a **finite** list of 6 real
target sizes. Each is a distinct static HTML file (same static CF Pages deploy; no SSR, no
adapter) that embeds the real `CompressTool`, has its own title/canonical/`FAQPage` schema,
and is linked from the main `/compress-pdf/` page (and each size page cross-links the others).

Rules that keep this legitimate (not a content farm):
- Keep the list **small and finite** (6 sizes) — it clusters real search demand, it does not scale into spam.
- Every page embeds the working tool; copy stays honest (never claims an exact byte count — results vary).
- New links here must use trailing-slash canonical form.

## Intent traps — do NOT target

- **"unlock pdf without password" / "pdf password remover without password"** — high volume but
  the tool *requires* the password (it is not a cracker). Targeting it = misleading + bounced
  visits. We bid only on the correct-intent variants (`remove pdf password from my pdf`).
- **Exact-size promises on compress ("to exactly 200 KB")** — the tool is level-based
  (Light/Balanced/Maximum), not exact-target. Answers are honest about this.
- **Watermark removal on flattened/baked-in watermarks** — documented as impossible.

## GEO (Generative Engine Optimization)

- **Aim to be *cited* in AI answers, not baked into training data.** A citation is the fast,
  controllable path into an AI answer. For a tool site the *tool page* is what gets referenced,
  so the citable asset is the FAQ + factual, verifiable copy: *"runs entirely in your browser"*,
  *"files are never uploaded — verify by disconnecting the internet"*, *"AES-256"*,
  *"checked locally against Adobe's AATL trust list"*.
- **Robots + llms.txt are set up and kept**, but treated as *supplementary*: Ahrefs' 137K-site
  study found 97% of llms.txt files are never read. AI crawlers are allowed in `robots.txt`;
  `/llms.txt` and `/llms-full.txt` ship a clean factual summary.
- **Agent traffic is real** (Cloudflare reports 50%+ of traffic is now agents). Static HTML +
  accessibility + no-login tool pages are the robust baseline; keep them render-free-friendly.
- Guard against "crocodile-mouth" pages (impressions steady, clicks falling) in GSC — the
  signature of AI answers absorbing clicks rather than a ranking problem. Rebuild those around
  queries AI can't fully answer, or repurpose to tools.

## Technical SEO foundation (all in place, keep it that way)

- All pages: unique `<title>`, meta description, one H1, canonical tag, OG tags, JSON-LD
  (`WebApplication` on tools, `Article`+`FAQPage` on blog).
- Sitemap: `@astrojs/sitemap` emits `sitemap-index.xml` → `sitemap-0.xml` (33 URLs: 27 original + 6 programmatic compress size pages).
  `robots.txt` points crawlers at `sitemap-index.xml`. **Do not submit `/sitemap.xml`** to
  Search Console — that path serves the SPA shell; the real sitemap is `sitemap-index.xml`.
- **All internal links use canonical trailing-slash URLs** (e.g. `/split-pdf/`), so no 308 hop
  on any internal link. Keep this true for any new links you add.

## Keyword validation workflow (before building/expanding a page)

1. In Ahrefs Keywords Explorer: set **KD ≤ 30**, apply the **Lowest DR** filter (does a
   low-authority site already rank? → winnable), sort by **Traffic Potential** (not raw volume).
2. **Sanity-check SERP page-type**: if page-1 is thin single-purpose tool pages → a tool page
   (or FAQ expansion) wins. If page-1 is 3,000-word guides → intent isn't a tool; use a blog post.
3. Cross-check with Search Console 28d: queries already sending impressions at pos 4–20 are the
   fastest CTR wins (titles/metas); pos 60+ long-tails are the position plays.

## Changelog

- **2026-08-19** — Canonicalized every internal link to trailing-slash form across `.astro`
  pages, `src/lib/tools.ts`, `src/layouts/Base.astro` (footer/nav), and all blog `.md`
  (removes 308 hops sitewide).
- **2026-08-19** — Split-PDF blog post retitled to a direct-intent, transaction-matching title
  and description for the "split pdf into separate pages" query.
- **2026-08-19** — Added winnable long-tail FAQ entries (+ `FAQPage` schema) to all 8 tool pages
  per the shortlist above; refined `/compress-pdf/` description to target "compress without
  losing quality".
- **2026-08-19** — Added programmatic `/compress-pdf/to-{100kb,200kb,500kb,1mb,2mb,5mb}/` size
  pages via `getStaticPaths()` (finite, static, embed the real tool). Cross-linked from
  `/compress-pdf/` and between size pages.
