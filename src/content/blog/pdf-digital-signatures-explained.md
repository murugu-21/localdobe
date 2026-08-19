---
title: 'PDF digital signatures: how to check if a PDF is signed'
description: 'What a PDF digital signature actually proves, how integrity validation works, and how to inspect signature evidence without uploading the file.'
pubDate: 2026-07-31
tags: ['signatures', 'privacy']
---

A PDF that shows a signature icon in your viewer feels reassuring, but "signed" is doing more work than most people realize, and it's worth understanding exactly what a digital signature does and doesn't guarantee before you rely on one for something important — a signed contract, a notarized filing, an invoice you're trusting for payment.

## A digital signature answers two separate questions

It's easy to think of "checking a signature" as one thing, but it's actually two distinct checks that get conflated:

**Integrity: has the signed content changed since it was signed?** When a PDF is digitally signed, a cryptographic hash of the document's content is computed and embedded alongside the signature. Reopening the document and recomputing that hash tells you, with mathematical certainty, whether a single byte of the signed content has changed since signing. This is deterministic — either the hash matches or it doesn't — and it's something that can be checked entirely locally, without needing to trust any external authority.

**Identity trust: is the certificate that produced the signature actually issued to the person or organization it claims to be, by an authority worth trusting?** This is a different kind of check. It requires validating a chain of certificates back to a root certificate authority your system trusts — the same infrastructure that underlies HTTPS on the web. Answering this fully requires access to a trust store: the list of certificate authorities your operating system or browser has decided to trust.

These two checks are independent. A document can have a fully intact signature (nothing has been tampered with) while the trust-chain check is inconclusive, and vice versa in theory. Understanding the difference matters because "not fully verified" and "tampered with" are very different findings that a sloppy tool might present identically.

There's a third nuance worth knowing, because it explains a result that otherwise looks like a bug: a signature only ever covers the *revision* of the document that existed at the moment it was applied. PDFs support incremental saves, which means content — a filled-in form field, an annotation, even a second party's signature — can be appended to the file after the first signature was written, without invalidating that earlier signature. This is normal and often intentional: it's exactly how a contract gets signed by one party and then countersigned by another without either signature breaking. But it also means "this signature is intact" specifically answers "has anything this signature covers been altered," not "is this the final, unmodified version of the file I'm holding." A good validator tells you which revision a given signature covers, rather than implying it vouches for every byte in the current document.

## Why in-browser trust-chain checking has a real limit

This is worth being direct about: web browsers don't expose their OS-level certificate trust store to web pages, for sound security reasons — a web page having arbitrary access to your system's trust decisions would be a significant attack surface. [localdobe's signature validator](/validate-pdf-signature/) solves this by bundling its own trust anchors: the same publicly published trust list Adobe Acrobat uses (the Adobe Approved Trust List), shipped with the tool and checked entirely on your device. Document integrity (the cryptographic hash check) and identity trust (the certificate chain check) both run locally.

One check is genuinely impossible without a network call: revocation — whether a certificate was cancelled by its authority *after* being issued. Because everything here runs offline, that check is skipped and clearly noted in the report rather than silently assumed to have passed. A signer whose authority isn't on Adobe's list (a company-internal certificate, for instance) is reported as "couldn't be fully verified" — an honest description, not a defect in the signature. If a signature's validity needs to hold up for a legal purpose (challenging it in court, for instance), have it examined with tooling and processes built for that; for the everyday questions — has this document been altered, who signed it, and is their authority recognized — localdobe answers on your device.

## How to check a PDF's signature

On the [validate PDF signature tool](/validate-pdf-signature/):

1. Drop your signed PDF into the upload box, or click it to browse your device.
2. The tool reports a clear verdict — valid, not valid, or found-but-not-fully-verifiable — along with who signed it, which authority issued their certificate, when it was signed, the certificate's validity window, and whether the document changed since signing.
3. If needed, use the remove-signature option to strip the signature object — this doesn't alter the page content, it simply removes the signature, leaving a document that's no longer signed.

## Why local checking matters for signed documents specifically

Documents worth signing are, almost by definition, documents worth protecting: contracts, notarized filings, signed invoices, legal agreements. Uploading one of these to a server just to check whether it's been tampered with means handing over the exact document (and its signature) to a third party for the sake of a yes-or-no answer you could get without that exposure. localdobe validates and can remove signatures entirely inside your browser tab — the document is never transmitted, logged, or stored on any server in the process.

## The short version

A signature icon means something specific and checkable: whether signed content has been altered since signing. It doesn't automatically mean the signer's identity has been fully verified against a trust chain — that's a separate, harder question that browser sandboxing limits by design. For the integrity question, which covers most everyday needs, you can get a definitive answer without uploading the document anywhere. For more on how "is this online tool safe with my file" applies to signed documents specifically, see our post on [whether online PDF tools are safe](/blog/are-online-pdf-tools-safe/).
