import type { PdfcpuCmd } from '../../workers/pdfcpu.worker';

/**
 * Translates raw pdfcpu engine errors into plain language before they reach the UI.
 * The site is for non-technical users: "optimize: prepare PDF context: read context:
 * encryption setup: please provide the correct password" must never be shown as-is.
 *
 * Deliberately NOT translated: validateSignatures' "no signatures present" sentinel —
 * SignatureTool matches that exact engine wording to render the "no signatures" report.
 */
export function friendlyEngineError(cmd: PdfcpuCmd, raw: string): string {
  if (cmd === 'validateSignatures' && /no signatures? present/i.test(raw)) return raw;

  if (/pdfcpu panic/i.test(raw)) {
    return 'The PDF engine hit an unexpected problem with this file. If it keeps happening, the file may use features we don’t support yet.';
  }

  const passwordNeeded = /please provide the correct password|encryption setup/i.test(raw);
  if (cmd === 'decrypt') {
    if (/not encrypted/i.test(raw)) return 'This PDF isn’t password-protected — there’s nothing to unlock.';
    if (passwordNeeded || /password/i.test(raw)) return 'That password didn’t work. Double-check it — unlocking needs the exact password the file was protected with.';
  }
  if (cmd === 'encrypt' && /this file is encrypted/i.test(raw)) {
    return 'This PDF is already password-protected. Unlock it first (see the Unlock tool) if you want to set a new password.';
  }
  if (passwordNeeded || /this file is encrypted/i.test(raw)) {
    return 'This PDF is password-protected. Remove the password first with the Unlock tool, then try again.';
  }

  if (cmd === 'watermark' && /no watermarks found/i.test(raw)) {
    return 'No removable watermarks were found in this file. Watermarks that were flattened into the page image can’t be cleanly removed.';
  }

  if (/prepare PDF context|read context|page not found|missing page node|xref|parse|corrupt/i.test(raw)) {
    return 'This file doesn’t look like a valid PDF — it may be damaged. Try re-downloading or re-exporting it, then run it through again.';
  }

  // Unknown engine error: keep the UI clean and put the raw detail in the console
  // so bug reports are still diagnosable.
  console.error(`pdfcpu ${cmd} error:`, raw);
  return 'Something went wrong while processing this PDF on your device. The file may be unusual — try re-exporting it from its original source.';
}
