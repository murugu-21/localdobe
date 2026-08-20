---
title: 'Open source PDF tool: the license behind localdobe (MIT & Apache 2.0)'
description: 'localdobe is an open source PDF tool: MIT-licensed code, an Apache-2.0 engine (pdfcpu), all running in your browser. This is why we open-sourced it.'
pubDate: 2026-08-19
tags: ['open-source', 'licensing', 'privacy', 'security']
faq:
  - q: 'Is localdobe open source?'
    a: 'Yes. The localdobe codebase is published under the MIT License on GitHub and is public for anyone to read, audit, and fork. Its PDF engine, pdfcpu, is open source under the Apache 2.0 License.'
  - q: 'What is the difference between Apache 2.0 and AGPL?'
    a: 'Apache 2.0 is a permissive license: you can embed, modify, and redistribute the software and combine it with almost anything, without conditions on your own code. AGPL is a strong copyleft license that, among other things, requires source to be offered to anyone who interacts with the software over a network. Both are open source; they differ in the obligations they place on you.'
  - q: 'Why does the license of a PDF engine matter?'
    a: 'Because the engine is what actually processes your file. A permissive license means the tool can be built, shared, and verified openly. A permissive, auditable engine is a good sign that the tool above it can be too.'
  - q: 'Does localdobe upload my PDF anywhere?'
    a: 'No. Every operation runs inside your browser on your own device. Your file is never transmitted to, logged on, or stored by a server — the tools even keep working if you go offline after the page loads.'
  - q: 'How can I verify what localdobe does?'
    a: 'Because the code is public, you can read it, audit it, or have someone you trust review it at github.com/murugu-21/localdobe. That verification is the whole point of open source.'
---

localdobe is now fully **open source** — and the licenses it's built on are worth a plain explanation, because they're the quiet reason a "free" PDF tool can actually be trustworthy.

## The engine: Apache 2.0 (permissive)

localdobe runs on [pdfcpu](https://github.com/pdfcpu/pdfcpu), a PDF engine written in Go and compiled to WebAssembly. It's licensed under **Apache 2.0**.

Apache 2.0 is what's called a *permissive* license. In plain terms, that means the software can be freely embedded, modified, and redistributed, and combined with almost anything else — including our own MIT-licensed code. There are no "strings attached" forcing us to leak our own work or hide how things behave. A permissive engine is the easiest, most transparent thing to build a tool on.

## Our code: MIT, and fully public

On top of that permissive base, all of **localdobe's own code is published under the MIT License** and lives in a public repository on GitHub. MIT is the simplest open-source license there is: you can read it, copy it, modify it, and use it, with almost no conditions beyond keeping the copyright notice.

Why publish it? Because open source is the difference between "trust us" and "check for yourself." When our source is public, anyone — including you, or an engineer you trust — can read exactly what the tool does and doesn't do. Nothing is a black box.

## Why permissive and open matters

Not every "free" tool is built on a permissive, auditable stack, and the software license underneath a PDF tool quietly shapes everything above it:

- A **permissive, open engine** (like ours) can be shared and verified freely.
- A **copyleft engine** (like AGPL) also has real, useful source-availability guarantees, but it carries more conditions about how it can be distributed — which is a legitimate consideration, but a very different one from permissive.

Understanding which one a tool uses tells you a lot about whether the tool above it can be open too. We chose the path where the whole stack — our code *and* the engine — can be open, and everything runs in your browser on your device.

## How localdobe actually processes files

Two things make localdobe straightforward to trust:

1. **It runs locally.** Compression, splitting, merging, and editing all happen inside your browser on your own device. Your file is never uploaded, logged, or stored anywhere. Disconnect from the internet after the page loads and the tools keep working.
2. **It's verifiable.** The code that does all of this is public under the MIT License, so anyone can read it.

That combination — permissive engine, open source, local processing — is why we can answer clearly when people ask what our tool does with their files: nothing happens to them except on the device they're already on.

## Try it, or audit it

You can [compress a PDF](/compress-pdf/), [split a PDF](/split-pdf/), or [merge PDFs](/merge-pdf/) entirely in your browser. Or read the code at [github.com/murugu-21/localdobe](https://github.com/murugu-21/localdobe). We'd rather you check than take our word for it.
