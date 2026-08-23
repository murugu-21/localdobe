---
title: 'How to split a PDF offline — no internet, no upload'
description: 'Split or extract PDF pages with no internet connection: localdobe is a web app that runs entirely on your device, so airplane mode is no obstacle.'
pubDate: 2026-08-23
tags: ['split', 'privacy', 'how-to']
faq:
  - q: 'Do I need to install anything to split a PDF offline?'
    a: 'No. Visit the site once while online and your browser caches the whole app. Optionally, use your browser''s "Install" or "Add to Home Screen" option to keep it as an app.'
  - q: 'Which PDF tools work offline?'
    a: 'Split, extract pages, and merge work fully offline after your first visit. Compression, watermarking, and password tools fetch a larger engine the first time you use them — after that, they work offline too.'
  - q: 'Is the offline version different from the online one?'
    a: 'No — it''s the same tool. localdobe always runs on your device; being offline just makes that impossible to fake.'
---

Most "online PDF splitter" results have a hard dependency you only notice at the worst moment: they need to upload your file to a server before they can do anything. On a plane, on a train through a dead zone, in a building with locked-down Wi-Fi, or on a network where you simply don't want a contract transiting someone else's infrastructure — an upload-based tool is a blank progress bar.

Splitting a PDF doesn't actually require a server. The pages are right there in the file, and your browser is more than capable of copying them into a new document by itself. This post covers how to split a PDF with no internet connection at all — and why the same property makes it the most private way to do it even when you're online.

## Why a web-based PDF splitter can work offline

localdobe is a local-first web app (a PWA). The first time you visit, your browser quietly caches the pages and the processing code. From then on, opening the site doesn't need a connection — and the actual splitting never needed one, because every page copy happens in your browser tab with [pdf processing running as WebAssembly](/blog/webassembly-pdf-tools/) on your own machine. There is no upload step to be blocked by a missing connection, because there is no upload step at all.

## How to split a PDF without internet

1. While online, open the [split PDF tool](/split-pdf/) once so your browser caches the app. If you like, use your browser's **Install app** / **Add to Home Screen** option.
2. Later — offline, in airplane mode, wherever — open the site again. It loads from the cache.
3. Drop in your PDF, tap the pages you want or type ranges like `1-3, 5, 7-`, and download the result. Everything works exactly as it does online.

The same applies to [extracting specific pages](/extract-pdf-pages/) and [merging PDFs](/merge-pdf/): those tools ship with the app and run fully offline after your first visit. The heavier tools — compression, watermarking, password protect/unlock — download a larger processing engine the first time you use them, and work offline from then on.

## Airplane mode is the honest test

Any site can *say* your files aren't uploaded. Offline operation is the claim you can verify yourself in ten seconds: switch on airplane mode, split a document, and watch it work. A tool that needs your file on its servers physically cannot pass that test — which is exactly why [it's worth asking what happens to files you upload](/blog/are-online-pdf-tools-safe/) to conventional converter sites.

If the document you're splitting is sensitive enough that you're reaching for airplane mode deliberately, you may also want the companion post on [splitting confidential PDFs safely](/blog/split-confidential-pdf-safely/).
