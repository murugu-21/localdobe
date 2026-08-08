---
title: 'How to password-protect a PDF for free (offline)'
description: 'Encrypt a PDF with AES-256 in your browser — no upload, no signup. Why local encryption matters when a password is involved.'
pubDate: 2026-08-04
tags: ['encryption', 'how-to', 'privacy']
---

Adding a password to a PDF is one of the more common reasons someone needs a PDF tool at all — sending a sensitive document by email, protecting a file before it goes on a shared drive, or complying with a client's requirement that anything containing financial details be encrypted before it's sent. It's also one of the operations where using an upload-based online tool makes the least sense, for a reason that's easy to overlook: you'd be sending both the document and its new password to a stranger's server, which defeats a large part of the point of encrypting it.

## How to password-protect a PDF

On the [protect PDF tool](/protect-pdf):

1. Drop your PDF into the upload box, or click it to browse your device.
2. Enter and confirm a password.
3. Click **Protect PDF** and download the encrypted file.

The encryption happens using AES-256 — a well-established symmetric encryption standard, the same class used by banks and governments for sensitive data — running inside a WebAssembly engine in your browser. The password you typed and the file you're protecting both stay on your device throughout.

## Why local encryption specifically matters here

For most PDF operations — merging, splitting, compressing — the argument for local processing is about not exposing document contents unnecessarily. Password protection raises the stakes on that argument in a specific way: encrypting a file is supposed to be the step that makes it safe to send somewhere less trusted. If you upload the unencrypted file and your chosen password to a server to have that server do the encrypting, you've briefly handed over both the plaintext document and the exact secret meant to protect it, to a third party, before the protection even takes effect. Even if that server deletes everything immediately afterward and never misuses either piece, the sequence itself undermines the reason you wanted encryption in the first place.

Doing this in your browser instead removes that step entirely. The file is read locally, AES-256 encryption is applied locally using the password you entered locally, and the encrypted result is written back out to your device — no network request carries either the document or the password anywhere. This isn't a matter of trusting a privacy policy; there's structurally no server in the process to receive either piece of information.

## What AES-256 actually gives you

AES-256 refers to the Advanced Encryption Standard using a 256-bit key — a widely studied, widely trusted algorithm that scrambles a document's contents such that recovering the original requires the correct key (derived from your password). It's not a proprietary or unusual scheme; it's the same standard used broadly across security-sensitive software, chosen specifically because it's been extensively analyzed and hasn't been broken through cryptanalysis, only through weak passwords or key management.

That last point matters practically: AES-256 encryption is only as strong as the password protecting it. A short, guessable password undermines a strong algorithm just as thoroughly as a weak algorithm would. If you're protecting something genuinely sensitive, a longer, unique password is worth the minor inconvenience of writing it down somewhere safe — and worth pairing with a tool that never sees either the file or the password, a distinction covered in more depth in our post on [whether online PDF tools are safe](/blog/are-online-pdf-tools-safe).

## There's no password recovery, by design

Because the password never leaves your device and isn't stored anywhere — not by localdobe, not by anyone — there's no "forgot password" flow available if you lose it. That's not a missing feature; it's the direct consequence of the encryption actually working the way it's supposed to. A service that could recover your password for you would necessarily have to know or store it somewhere, which would undermine the whole premise. Write your password down somewhere durable before you close the tab.

If you already know the password on a protected PDF and just need to remove it — because you're tired of retyping it, for instance — that's a different operation from protecting a new file, covered in our companion post on [how to remove a password from a PDF you own](/blog/remove-pdf-password).

## When password protection is (and isn't) enough

A password-protected PDF is a meaningful layer of protection against casual access — someone finding the file on a shared drive or in an email attachment can't open it without the password. It's not a substitute for controlling who receives the file and the password in the first place; anyone with both can open the document regardless of how strong the encryption is. Used sensibly — a strong password, shared through a separate channel from the file itself — it's a genuinely useful, genuinely free way to add a real layer of protection to a document before it leaves your hands.
