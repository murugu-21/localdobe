---
title: 'How to split a PDF into separate pages (offline & free)'
description: 'Split a PDF into individual pages or extract a range — locally in your browser, with no upload and no watermark. Step-by-step guide.'
pubDate: 2026-06-19
tags: ['split', 'how-to', 'privacy']
---

A 40-page scanned contract lands in your inbox and you need page 12 to send to your accountant. Or a school sends home a single PDF packet and you need to print just the permission slip on page 7. Splitting a PDF — pulling out one page, a range of pages, or breaking the whole thing into individual files — is one of those tasks that feels like it should take five seconds, but most "free" splitter sites turn it into an upload, a wait, and often a paywall once you hit more than a couple of pages.

There's no technical reason for any of that. A PDF's page structure is just data your browser can already read — that's how it renders the preview you're looking at. This post covers how to split a PDF into separate pages without uploading it anywhere, plus a few tips on page-range syntax that make the job faster.

## How to split a PDF

Head to the [split PDF tool](/split-pdf) and:

1. Drop your PDF into the upload box, or click it to browse your device.
2. Click the thumbnails of the pages you want, or type a range directly — something like `1-3, 5, 7-` selects pages 1 through 3, page 5, and page 7 through the end.
3. Click **Split PDF** and the result downloads straight to your device.

If you need every page as its own file instead of a single extracted range, choose "Every page as its own PDF." You'll get a zip file with one PDF per page, generated in the same local step.

## Page-range syntax that saves time

Typing individual page numbers works for small selections, but ranges are faster once a document gets long:

- `1-3` grabs pages one through three.
- `5, 9, 14` grabs three separate, non-adjacent pages.
- `7-` grabs page seven through the last page, without needing to know the total page count.
- Combine them: `1-3, 5, 7-` does all three at once in a single split.

This mirrors the range syntax you'd expect from a print dialog, which makes it easy to remember — if you can describe the pages you want to a printer, you can describe them here.

## What happens to your pages when you split locally

The split tool reads your PDF's byte structure directly in your browser using pdf.js, the same rendering engine Firefox uses to display PDFs natively, combined with logic that copies the specific page objects you selected into a new, independent PDF file. Nothing about this process requires a server: your browser already has to parse the whole document just to show you the thumbnails to click on, so extracting a subset of pages is a local operation on data your machine already holds in memory.

That matters more than it might seem. When you upload a 40-page document to split out one page, most online tools receive — and briefly store — the entire file, including the 39 pages you had no intention of sharing. If that document is a signed lease, a medical intake form, or a set of tax records, the other 39 pages are exposed for no reason connected to what you actually needed to do. Splitting locally means only the page you selected ever exists outside your device, because nothing left your device in the first place.

The output is also lossless. Splitting doesn't re-render or recompress anything — it copies the underlying page objects (text, images, vector graphics, fonts) exactly as they were, so extracted pages look pixel-for-pixel identical to the source.

## When you actually want extraction, not splitting

"Split" and "extract" get used interchangeably, but there's a useful distinction: splitting usually means breaking a whole document apart (often into one file per page), while extraction means pulling out a specific subset and leaving the rest behind. Both use the exact same range syntax and the exact same tool here — the difference is just which output option you pick. If you're mainly interested in the extraction side, with more examples of range syntax for tricky cases like extracting every other page or the last three pages of a long report, see our companion post on [how to extract specific pages from a PDF](/blog/extract-pages-from-pdf).

## Why "free" splitters often aren't as free as they look

Plenty of splitter sites are genuinely free for a single small file, then introduce friction as soon as you need more: a five-page limit, a forced account creation, or a processing fee once your document crosses some threshold. That friction exists because those tools are paying for server compute and storage on every file you send them — the incentive to monetize increases with your usage. A browser-based splitter has essentially no marginal cost per page, because your own device is doing the work, which is why there's no reason to gate the feature behind a limit or a signup wall here.

## The bigger picture

Splitting is a small, mundane task, but it's representative of a broader pattern in PDF tooling: most operations people reach for — merging, compressing, watermarking, signing — can be done with well-understood libraries running directly in a browser tab, without ever needing a server in the loop. The next time a document needs to be pulled apart, you shouldn't have to hand the whole thing over just to get a few pages back out.
