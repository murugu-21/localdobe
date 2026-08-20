---
title: 'Open source PDF tool: Apache 2.0 vs AGPL, and why it matters'
description: 'Free PDF tools run on engines with very different licenses. localdobe uses Apache-2.0 pdfcpu; AGPL engines like Ghostscript carry source-disclosure duties.'
pubDate: 2026-08-19
tags: ['open-source', 'licensing', 'privacy', 'security']
faq:
  - q: 'Is localdobe open source?'
    a: 'Yes. The entire localdobe codebase is published under the MIT License on GitHub and is public for anyone to read, audit, and verify. Its PDF engine, pdfcpu, is itself open source under the permissive Apache 2.0 License.'
  - q: 'Does localdobe upload my PDF anywhere?'
    a: 'No. Every operation runs inside your browser on your own device. Your file is never transmitted to, logged on, or stored by a server — disconnect from the internet after the page loads and the tools still work.'
  - q: 'What is the difference between Apache 2.0 and AGPL?'
    a: 'Apache 2.0 is a permissive license: you can embed, modify, and redistribute the software, and combine it with almost anything. AGPL is a strong copyleft: if users interact with your modified version over a network, you must make the complete corresponding source available to them and release your changes under AGPL.'
  - q: 'Why does the PDF engine’s license matter?'
    a: 'Because a “free” tool is only free to you if the software underneath it is lawfully distributed. A tool built on a permissive engine (like localdobe’s Apache-2.0 pdfcpu) is straightforward to ship and to verify. A tool that ships a copyleft engine like AGPL Ghostscript carries source-disclosure obligations that a closed, private distribution rarely satisfies.'
  - q: 'What engine do other free PDF tools use?'
    a: 'It varies. The notable one is ihatepdf.cv, which distributes Ghostscript compiled to WebAssembly. Ghostscript is licensed under AGPL (or a paid commercial license) — a very different legal position from the permissive engine localdobe runs.'
---

What is the one factor that quietly decides the whole legal and commercial position of a "free" PDF tool?

It's not the marketing. It's **the license of the PDF engine underneath it.**

Every PDF tool — "free" or paid — is built on someone's PDF-processing software. That software comes with a license, and that license determines what the tool's maker is legally allowed to do with it, and what they are required to disclose to you. Most people never look at it. It happens to be the most important thing about the product.

## localdobe's engine: permissive, Apache 2.0

localdobe runs on [pdfcpu](https://github.com/pdfcpu/pdfcpu), a PDF engine written in Go and compiled to WebAssembly. It's licensed under **Apache 2.0** — a *permissive* open-source license.

Permissive is the easy case. Apache 2.0 lets you embed, modify, and redistribute the software, and combine it with nearly anything — including with our own MIT-licensed code. There are no copyleft strings attached, and there's no requirement to hand your source code to your users. That's why we could ship localdobe as a genuinely free tool, open-source our own code under MIT, and make the entire repository public for anyone to audit. Nothing about our stack depends on a license restriction being ignored.

## The other side: an AGPL engine, distributed as WebAssembly

A growing number of free PDF tools take a different route.

ihatepdf.cv, for example, distributes **Ghostscript** compiled to WebAssembly and runs it in your browser. Ghostscript is a powerful, decades-old PDF engine — but its open-source license is **AGPL** (the GNU Affero GPL), not a permissive one. (Artifex also sells commercial licenses, but the free flavor is AGPL.)

AGPL is a *strong copyleft* license, and that distinction matters enormously here. Under AGPL:

- If users **interact with your modified version over a network**, you must make the **complete corresponding source code** available to them. That clause — section 13, written specifically for web services — applies when you serve software to a network user, and shipping a WASM engine that users' browsers download and execute is exactly the kind of network interaction AGPL was designed to cover.
- Any changes or derivative works must also be released under AGPL.

So distributing an AGPL engine in a closed, proprietary, single-purpose tool puts the distributor **in a legal position that a permissive stack never faces**: either comply with the source-disclosure obligations, or don't distribute it lawfully at all. A private, closed distribution with no source offer is, at best, sitting in an unsupported legal gray area — and the burden sits entirely with the distributor.

That's the real difference between ihatepdf.cv and localdobe: **not** "which has shinier buttons," but *our engine is permissively licensed and fully open, and theirs is a copyleft engine that is legally harder to distribute than it looks.*

## Open source is the trust layer, and it has to be real

We open-sourced localdobe for a reason: **you shouldn't have to take our word for anything.**

Open source is only meaningful if it's *real* — a published repository under a license that actually grants you rights. Our code is public under the MIT License, and anyone can read, audit, and fork it. The engine under the hood, pdfcpu, is Apache 2.0, so the whole stack — tool *and* engine — is permissive and auditable.

A tool that ships a copyleft engine in a closed repository asks you to trust a bundle of things you can't verify: that the engine is lawfully distributed, that the copyleft obligations were met, and that the code does what it claims. "Trust us" is a weaker guarantee than "check for yourself" — and the license under the hood is exactly what a check reveals.

## Three questions for any free PDF tool

1. **What engine is under the hood, and under what license?** Permissive (Apache, MIT, BSD) means it can be freely embedded and shared. Copyleft (GPL, AGPL) means whoever ships it carries source-disclosure obligations you can't see from the outside.
2. **Is the source actually public?** If the repo is private or invisible, your only options are trust and more trust. If it's open, you or anyone you trust can verify it.
3. **Where does your file go?** We run everything locally, so your PDF never leaves your device — that's independent of the license question, but it's why the whole point of a *free* tool doesn't have to come with hidden costs.

localdobe's answers: **pdfcpu, Apache 2.0. Public, MIT. Nowhere.** You can [compress a PDF](/compress-pdf/), [split a PDF](/split-pdf/), or [merge PDFs](/merge-pdf/) entirely in your browser, and audit the code at [github.com/murugu-21/localdobe](https://github.com/murugu-21/localdobe). We'd rather you verify us than trust us blindly.
