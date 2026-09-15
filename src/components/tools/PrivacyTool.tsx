import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { track } from '../../lib/analytics';
import { FILE_READ_ERROR, readFileBytes } from '../../lib/readFile';
import { REPLAY_MASK } from '../../lib/replay';
import { FileDropzone } from './shared/FileDropzone';
import { ToolError } from './shared/ToolError';
import { DownloadResult } from './shared/DownloadResult';
import { ProgressBar } from './shared/ProgressBar';
import type { PrivacyFinding, PrivacyReport } from '../../lib/pdf/privacyScan';

type Phase = 'idle' | 'working' | 'done' | 'error';

const SEVERITY = {
  personal: { label: 'Identifies you', chip: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
  hidden: { label: 'Hidden in the file', chip: 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200' },
  informational: { label: 'Also shared', chip: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
} as const;

function FindingCard({ finding }: { finding: PrivacyFinding }) {
  const severity = SEVERITY[finding.severity];
  return (
    <div data-testid="privacy-finding" className="rounded-xl border border-border bg-panel/40 p-5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">{finding.title}</p>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', severity.chip)}>{severity.label}</span>
      </div>
      <p className="mt-2 text-muted-foreground">{finding.detail}</p>
      {finding.values.length > 0 && (
        <ul className={`mt-3 space-y-1 ${REPLAY_MASK}`}>
          {finding.values.map((value, i) => (
            <li key={i} className="rounded-md bg-background px-2 py-1 font-mono text-xs break-all">
              {value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PrivacyTool() {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [report, setReport] = useState<PrivacyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keepTitle, setKeepTitle] = useState(true);
  const [removeAttachments, setRemoveAttachments] = useState(true);
  const [removeJavaScript, setRemoveJavaScript] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [cleaned, setCleaned] = useState<Uint8Array | null>(null);

  async function onFile([f]: File[]) {
    const bytes = await readFileBytes(f);
    if (!bytes) { setError(FILE_READ_ERROR); setPhase('error'); return; }
    setFile({ name: f.name.replace(/\.pdf$/i, ''), bytes });
    setPhase('working');
    setReport(null);
    setCleaned(null);
    setKeepTitle(true);
    setRemoveAttachments(true);
    setRemoveJavaScript(true);
    setError(null);
    // The check starts the moment a file lands — there is no separate run button,
    // so file_selected is immediately followed by this run.
    track('tool_run_started', { input_bytes: bytes.length });
    const startedAt = Date.now();
    try {
      const { scanPrivacy } = await import('../../lib/pdf/privacyScan');
      const result = await scanPrivacy(bytes);
      setReport(result);
      // Counts only. The finding values are document-derived text and must never
      // reach an event (see src/lib/analytics.ts).
      track('pdf_privacy_checked', {
        personal_count: result.counts.personal,
        hidden_count: result.counts.hidden,
        informational_count: result.counts.informational,
        revision_count: result.revisions,
        attachment_count: result.attachments,
        javascript_count: result.javascript,
        page_count: result.pageCount,
        input_bytes: bytes.length,
        duration_ms: Date.now() - startedAt,
      });
      setPhase('done');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not check this PDF.';
      track('tool_failed', { message, reason: 'scan_failed', duration_ms: Date.now() - startedAt });
      setError(message);
      setPhase('error');
    }
  }

  function clear() {
    track('tool_reset');
    setFile(null);
    setPhase('idle');
    setReport(null);
    setCleaned(null);
    setError(null);
  }

  async function clean() {
    if (!file) return;
    setCleaning(true);
    setError(null);
    track('tool_run_started', { action: 'clean', remove_attachments: removeAttachments, remove_javascript: removeJavaScript });
    const startedAt = Date.now();
    try {
      const { cleanPdf } = await import('../../lib/pdf/cleanPdf');
      const output = await cleanPdf(file.bytes, {
        keepTitle,
        removeAttachments: removeAttachments && (report?.attachments ?? 0) > 0,
        removeJavaScript: removeJavaScript && (report?.javascript ?? 0) > 0,
      });
      setCleaned(output);
      track('pdf_privacy_cleaned', {
        remove_attachments: removeAttachments,
        remove_javascript: removeJavaScript,
        keep_title: keepTitle,
        output_bytes: output.length,
        duration_ms: Date.now() - startedAt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not clean this PDF.';
      track('tool_failed', { message, reason: 'clean_failed', duration_ms: Date.now() - startedAt });
      setError(message);
    } finally {
      setCleaning(false);
    }
  }

  const flagged = (report?.counts.personal ?? 0) + (report?.counts.hidden ?? 0);
  const summary = !report
    ? null
    : flagged > 0
      ? {
          title: 'Review before you send',
          tone: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950',
          body: `${report.counts.personal} item${report.counts.personal === 1 ? '' : 's'} identify you or your device, and ${report.counts.hidden} hidden or extra item${report.counts.hidden === 1 ? '' : 's'} ${report.counts.hidden === 1 ? 'is' : 'are'} stored in the file.`,
        }
      : report.findings.length > 0
        ? {
            title: 'No hidden data found',
            tone: 'border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950',
            body: 'Nothing personal or hidden turned up. The items below are still shared with the file, so they may matter.',
          }
        : {
            title: 'Nothing to report',
            tone: 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950',
            body: 'No identifying metadata, hidden content, scripts or embedded files found in this PDF.',
          };

  return (
    <div className="space-y-6">
      {!file && <FileDropzone label="Choose a PDF to check" onFiles={onFile} />}
      {file && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground"><span className={REPLAY_MASK}>{file.name}.pdf</span></p>
          <Button type="button" variant="ghost" size="sm" data-testid="clear-file" onClick={clear}>
            Start over
          </Button>
        </div>
      )}
      {phase === 'working' && <ProgressBar value={null} />}
      {error && <ToolError message={error} />}

      {phase === 'done' && report && summary && (
        <>
          <div data-testid="privacy-summary" className={cn('rounded-xl border p-5', summary.tone)}>
            <p className="font-semibold">{summary.title}</p>
            <p className="mt-1 text-sm">{summary.body}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {report.pageCount} page{report.pageCount === 1 ? '' : 's'} · {report.revisions} save revision{report.revisions === 1 ? '' : 's'}
            </p>
          </div>

          {report.findings.map((finding) => <FindingCard key={finding.id} finding={finding} />)}

          <p className="text-xs text-muted-foreground">
            {report.findings.length === 0
              ? 'Everything above was read on your device. Nothing was uploaded.'
              : 'Every finding above was read from the file on your device — nothing was uploaded. Values are shown as the file stores them.'}
          </p>

          {report.canClean && !cleaned && (
            <div data-testid="privacy-clean" className="space-y-4 rounded-xl border-2 border-primary/30 p-5">
              <div>
                <p className="font-semibold">Send a cleaner copy</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Rewrites the file from its current pages: metadata, XMP, file IDs, earlier revisions and leftover
                  objects are dropped. Page content and links stay exactly as they were.
                </p>
              </div>
              <div className="space-y-3">
                <Label className="flex items-center gap-2 text-sm font-normal">
                  <Checkbox
                    checked={keepTitle}
                    onCheckedChange={(v) => { setKeepTitle(v === true); setCleaned(null); }}
                  />
                  Keep the document title
                </Label>
                {report.attachments > 0 && (
                  <Label className="flex items-center gap-2 text-sm font-normal">
                    <Checkbox
                      data-testid="clean-attachments"
                      checked={removeAttachments}
                      onCheckedChange={(v) => { setRemoveAttachments(v === true); setCleaned(null); }}
                    />
                    Remove {report.attachments} embedded file{report.attachments === 1 ? '' : 's'} (attachments may be intentional)
                  </Label>
                )}
                {report.javascript > 0 && (
                  <Label className="flex items-center gap-2 text-sm font-normal">
                    <Checkbox
                      data-testid="clean-javascript"
                      checked={removeJavaScript}
                      onCheckedChange={(v) => { setRemoveJavaScript(v === true); setCleaned(null); }}
                    />
                    Remove JavaScript ({report.javascript}) — scripts that run in the reader
                  </Label>
                )}
              </div>
              <Button type="button" data-testid="clean-pdf" onClick={clean} disabled={cleaning} size="lg" className="w-full">
                Clean &amp; download
              </Button>
            </div>
          )}
          {cleaning && <ProgressBar value={null} />}
          {cleaned && file && (
            <DownloadResult
              filename={`${file.name}-clean.pdf`}
              bytes={cleaned}
              note="Metadata and hidden extras removed on your device. Check the result with this tool before you send it."
            />
          )}
          <p className="text-xs text-muted-foreground">
            A signed PDF that gets cleaned will no longer validate — if this document carries a signature, check it
            first with the <a href="/validate-pdf-signature/" className="font-medium text-accent underline underline-offset-2">signature tool</a>.
          </p>
        </>
      )}
    </div>
  );
}
