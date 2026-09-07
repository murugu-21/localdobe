/**
 * One call site for both analytics sinks.
 *
 * `track()` fans a single event out to PostHog (`window.posthog.capture`) and to
 * Microsoft Clarity (`window.clarity`). The two want different shapes:
 *
 *   - PostHog takes arbitrary properties and keeps numbers as numbers, so funnels
 *     can average and compare them.
 *   - Clarity only stores *string* tags, and a tag with unbounded values is
 *     useless in its filter UI — so every number is bucketed on the way in.
 *
 * Either sink may be missing: both scripts are third-party and routinely blocked
 * by extensions, and neither is emitted at all when its env var is unset. Nothing
 * here throws, so a blocked script can never take a PDF tool down with it.
 *
 * PRIVACY: localdobe's whole promise is that files never leave the device. Never
 * pass a file name, page text, password, or any file content into an event —
 * counts, byte sizes, durations, and fixed option values only. `message` is
 * scrubbed by `sanitizeMessage` because engine errors sometimes embed a name.
 * See `src/pages/privacy.astro` §4 and the `data-clarity-mask` wrapper in
 * `src/components/astro/ToolPageShell.astro`.
 */

/** Tool page slugs, kept in sync with the `href`s in `src/lib/tools.ts`. */
const TOOL_SLUGS = [
  'merge-pdf',
  'split-pdf',
  'extract-pdf-pages',
  'rotate-pdf',
  'compress-pdf',
  'jpg-to-pdf',
  'png-to-pdf',
  'pdf-to-jpg',
  'pdf-to-png',
  'edit-pdf',
  'watermark-pdf',
  'protect-pdf',
  'unlock-pdf',
  'validate-pdf-signature',
] as const;

export type ToolId = (typeof TOOL_SLUGS)[number];

/**
 * Event names. A union rather than free strings so a typo becomes a build error
 * instead of a silently orphaned event in the dashboard.
 *
 * The `pdf_*` success events predate this module and keep their original names so
 * existing PostHog history stays continuous, despite the inconsistent naming —
 * group by the `tool` property instead, which every event now carries.
 */
export type AnalyticsEvent =
  // Funnel, fired by every tool in the same order.
  | 'tool_viewed'
  | 'file_selected'
  | 'file_rejected'
  | 'tool_option_changed'
  | 'tool_run_started'
  | 'tool_failed'
  | 'result_downloaded'
  | 'tool_reset'
  // Site-level.
  | 'nav_tool_clicked'
  | 'sponsor_clicked'
  // Pre-existing per-tool success events.
  | 'pdfs_merged'
  | 'pdf_pages_split'
  | 'pdf_rotated'
  | 'pdf_compressed'
  | 'pdf_edited'
  | 'pdf_watermarked'
  | 'pdf_protected'
  | 'pdf_unlocked'
  | 'pdf_converted_to_image'
  | 'images_converted_to_pdf'
  | 'pdf_signatures_checked'
  | 'pdf_signatures_removed';

const KB = 1024;
const MB = 1024 * KB;

/** Size buckets for Clarity tags. Boundaries chosen to separate the cases we act on. */
export function bucketBytes(n: number): string {
  if (n < 100 * KB) return '<100kb';
  if (n < MB) return '100kb-1mb';
  if (n < 5 * MB) return '1-5mb';
  if (n < 10 * MB) return '5-10mb';
  if (n < 50 * MB) return '10-50mb';
  return '50mb+';
}

/** Count buckets for Clarity tags (pages, files, signatures). */
export function bucketCount(n: number): string {
  if (n <= 0) return '0';
  if (n === 1) return '1';
  if (n <= 5) return '2-5';
  if (n <= 20) return '6-20';
  if (n <= 100) return '21-100';
  return '100+';
}

/** Duration buckets for Clarity tags — how slow a run felt, not how long it took. */
export function bucketMs(n: number): string {
  if (n < 1_000) return '<1s';
  if (n < 5_000) return '1-5s';
  if (n < 15_000) return '5-15s';
  if (n < 60_000) return '15-60s';
  return '60s+';
}

const MESSAGE_MAX = 120;
/** Any path-ish or bare token ending in a document/image extension. */
const FILE_NAME = /\S*[\w)\]]\.(pdf|jpe?g|png|zip|tiff?|webp|gif|bmp|heic)\b/gi;

/**
 * Strips file names out of an error message and bounds its length.
 *
 * Engine errors are the one place a user's file name can reach an event by
 * accident (pdfcpu and pdf-lib both interpolate names into messages), so the
 * scrub happens here rather than at each of the dozen call sites.
 */
export function sanitizeMessage(message: string): string {
  return message
    .replace(FILE_NAME, '<file>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MESSAGE_MAX);
}

/**
 * The tool slug for a page path, or undefined when the page is not a tool page.
 *
 * Deriving this from the URL rather than a prop keeps `jpg-to-pdf` distinct from
 * `png-to-pdf` (one component, two pages) and `split-pdf` from `extract-pdf-pages`,
 * with nothing to thread through the component tree. The allowlist also stops an
 * arbitrary path from becoming an unbounded event property.
 */
export function toolFromPath(pathname: string): ToolId | undefined {
  const slug = pathname.replace(/^\/+|\/+$/g, '');
  return (TOOL_SLUGS as readonly string[]).includes(slug) ? (slug as ToolId) : undefined;
}

/** Turns one property into the string Clarity will store for it. */
function tagValue(key: string, value: string | number | boolean): string {
  if (typeof value === 'number') {
    if (key.endsWith('_bytes')) return bucketBytes(value);
    if (key.endsWith('_ms')) return bucketMs(value);
    return bucketCount(value);
  }
  return String(value).slice(0, MESSAGE_MAX);
}

/** Runs a sink, swallowing anything it throws — analytics never breaks a tool. */
function attempt(fn: () => void): void {
  try {
    fn();
  } catch {
    /* A blocked or half-loaded analytics script must stay invisible to the user. */
  }
}

/**
 * Records one user interaction in both sinks.
 *
 * `tool` is filled in automatically from the current path; pass it explicitly only
 * to attribute an event to a tool other than the page it happened on.
 */
export function track(event: AnalyticsEvent, props: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;

  const tool = toolFromPath(window.location.pathname);
  const entries: [string, string | number | boolean][] = [];
  for (const [key, value] of Object.entries({ tool, ...props })) {
    // Drop empty values rather than tagging sessions with "undefined".
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    entries.push([key, key === 'message' ? sanitizeMessage(String(value)) : value]);
  }

  attempt(() => window.posthog?.capture(event, Object.fromEntries(entries)));
  attempt(() => {
    const clarity = window.clarity;
    if (!clarity) return;
    clarity('event', event);
    for (const [key, value] of entries) clarity('set', key, tagValue(key, value));
  });
}
