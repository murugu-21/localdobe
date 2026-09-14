/**
 * One call site for analytics.
 *
 * `track()` sends an event to PostHog with its properties intact, so funnels can
 * average and compare the numbers.
 *
 * The SDK is the npm `posthog-js` build, dynamic-imported on the visitor's
 * first interaction (or a 10s fallback) rather than loaded with the page — see
 * `bootAnalytics`/`scheduleSdkLoad`. Calls made before it lands are buffered in
 * `pending` and replayed on arrival, so there is no "too early" to worry about.
 * Nothing here throws: analytics is a third-party dependency and must never
 * take a PDF tool down with it. It is also absent entirely when its env vars are
 * unset (local dev without a token), and every call then no-ops.
 *
 * PRIVACY: localdobe's whole promise is that files never leave the device. Never
 * pass a file name, page text, password, or any file content into an event —
 * counts, byte sizes, durations, and fixed option values only. `message` is
 * scrubbed by `sanitizeMessage` because engine errors sometimes embed a name.
 * Session replays hide the same things through the markers in `src/lib/replay.ts`,
 * applied by the tool components. See `src/pages/privacy.astro` §4.
 */

import { onFirstInteraction } from './first-interaction';

interface PostHog {
  capture(event: string, properties?: Record<string, string | number | boolean>): void;
  captureException(error: unknown, properties?: Record<string, string | number | boolean>): void;
  register(properties: Record<string, string | number | boolean>): void;
  init(token: string, config: Record<string, unknown>): void;
  startSessionRecording(): void;
}

/** Injectable for tests; production dynamic-imports the real browser SDK. */
export type SdkLoader = () => Promise<PostHog>;

const loadSdk: SdkLoader = () => import('posthog-js').then((m) => m.default as unknown as PostHog);

// Tool page slugs, kept in sync with the `href`s in `src/lib/tools.ts`.
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

// Set once initAnalytics resolves. Checked before the global so a booted SDK
// is used even if something else reassigns window.posthog (the PostHog toolbar
// does exactly that).
let sdk: PostHog | null = null;

// Non-null only while the SDK is loading: calls made in that window are held
// here and replayed on arrival. Null when analytics was never initialised
// (local dev, CI), so nothing accumulates.
let pending: Array<(ph: PostHog) => void> | null = null;

// Detaches the listeners bootAnalytics attaches for errors thrown before the
// SDK boots. Cleared by initAnalytics (success or failure) so PostHog's own
// exception autocapture owns them from then on.
let stopEarlyErrors: (() => void) | null = null;

const client = (): PostHog | null => {
  if (sdk) return sdk;
  const p = (globalThis as { posthog?: Partial<PostHog> }).posthog;
  return typeof p?.capture === 'function' && typeof p?.register === 'function' ? (p as PostHog) : null;
};

// Run now if the SDK is up, buffer if it is still loading, drop otherwise.
// Failures are swallowed: analytics must never break the caller.
const send = (fn: (ph: PostHog) => void): void => {
  const ph = client();
  if (!ph) {
    pending?.push(fn);
    return;
  }
  try {
    fn(ph);
  } catch {
    // storage blocked, SDK swapped out by consent tooling
  }
};

/**
 * Records one user interaction.
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

  send((ph) => ph.capture(event, Object.fromEntries(entries)));
}

/**
 * Reports an error the code caught itself.
 *
 * Uncaught errors and unhandled rejections are captured automatically (see the
 * `capture_exceptions` config and the buffering listeners in `bootAnalytics`);
 * this is only for failures swallowed on purpose that should not be invisible.
 * Like `track`, it buffers while the SDK loads and no-ops without it.
 */
export function reportError(error: unknown, props: Record<string, string | number | boolean> = {}): void {
  const entries = Object.entries(props).filter(([, value]) => typeof value !== 'string' || value.trim());
  send((ph) => ph.captureException(error, entries.length ? Object.fromEntries(entries) : undefined));
}

// How long a visitor who never interacts waits before the SDK loads anyway.
// Lighthouse stops observing a couple of seconds after the page goes quiet (it
// runs unthrottled and simulates the slow network afterwards), so this lands
// well outside its trace while still counting a visitor who only reads.
const SDK_LOAD_FALLBACK_MS = 10_000;

/**
 * Run `load` once: on the visitor's first input, or after `fallbackMs` if none
 * arrives (see ./first-interaction.ts for why this is not `scroll`).
 */
export function scheduleSdkLoad(
  load: () => void,
  target: EventTarget,
  fallbackMs: number = SDK_LOAD_FALLBACK_MS,
): void {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    cancel();
    clearTimeout(timer);
    load();
  };
  const cancel = onFirstInteraction(once, target);
  const timer = setTimeout(once, fallbackMs);
}

/**
 * Load posthog-js and point it at the proxy. Called from the layout with the
 * build-time token/host; with either missing (local dev, CI) it no-ops and
 * every track call is dropped.
 *
 * The import is dynamic so the SDK is a separate chunk fetched after the page
 * is interactive rather than part of the initial bundle — bootAnalytics
 * schedules it (see scheduleSdkLoad). Anything captured while it loads is
 * buffered and replayed, so an early click is not lost.
 */
export async function initAnalytics(
  token: string | undefined,
  host: string | undefined,
  load: SdkLoader = loadSdk,
): Promise<void> {
  if (!token?.trim() || !host?.trim() || sdk) return;
  pending ??= [];
  try {
    const ph = await load();
    ph.init(token.trim(), {
      api_host: host.trim().replace(/\/$/, ''),
      // PostHog's real domain, not the proxy — the toolbar needs it.
      ui_host: 'https://us.posthog.com',
      defaults: '2026-01-30',
      // Cookies are on. The random id they hold is what lets PostHog stitch a
      // visit into a single session and record a replay — posthog-js cannot
      // build a session id in cookieless mode. The cookie is first-party and
      // analytics-only; person profiles stay disabled, so no person record is
      // built and identify() remains a no-op.
      persistence: 'localStorage+cookie',
      person_profiles: 'never',
      // Session replay starts on the visitor's first interaction (below), not
      // at boot: the recorder is the SDK's heaviest extension, and a visitor
      // who never touches the page has nothing worth replaying. Recording must
      // also be switched on in the PostHog project's replay settings.
      disable_session_recording: true,
      session_recording: {
        // Tool components mark document-derived content with the classes in
        // `src/lib/replay.ts`: file names and document text carry `ph-mask`
        // (PostHog's default maskTextClass — text becomes asterisks, controls
        // and layout stay visible) and rendered page/image pixels carry
        // `ph-no-capture` (PostHog's default blockClass — the subtree becomes a
        // placeholder). The tool work area itself is deliberately unblocked so
        // replays show the buttons and options. `maskAllInputs` is pinned here
        // so typed values stay masked regardless of the project's dashboard
        // masking mode.
        maskAllInputs: true,
      },
      // Error tracking: unhandled errors and rejections become $exception
      // events. The SDK fetches one more small script to wrap the handlers,
      // which is why this rides the delayed SDK load rather than page start —
      // the listeners bootAnalytics attaches cover the window before it, and
      // are detached here so nothing is captured twice.
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
      // Extensions this site does not use. Each is a separate script the SDK
      // would otherwise fetch and evaluate after boot. Heatmaps and dead clicks
      // stay on by project decision, so their plugin still loads on interaction.
      disable_surveys: true,
      capture_performance: false,
    });
    sdk = ph;
    stopEarlyErrors?.();
    stopEarlyErrors = null;
    const win = (globalThis as { window?: EventTarget }).window;
    if (win && typeof win.addEventListener === 'function') {
      onFirstInteraction(() => {
        try {
          ph.startSessionRecording();
        } catch {
          // recorder blocked or offline — events still flow
        }
      }, win);
    }
    // Expose it the way the snippet would, so the PostHog toolbar can find it.
    (globalThis as { posthog?: PostHog }).posthog = ph;
    const queued = pending;
    pending = null;
    for (const fn of queued) {
      try {
        fn(ph);
      } catch {
        // one bad replay must not drop the rest
      }
    }
  } catch {
    // SDK chunk blocked or offline: stop buffering and let calls no-op.
    stopEarlyErrors?.();
    stopEarlyErrors = null;
    pending = null;
  }
}

/**
 * Read the PostHog config the layout renders into <meta> tags and schedule the
 * SDK load (scheduleSdkLoad). A meta tag rather than a data attribute on the
 * script element: Astro bundles `<script>` as a module, and
 * `document.currentScript` is null in module scope.
 *
 * This also (re)starts error tracking. The SDK waits for the first interaction,
 * so its own exception autocapture misses everything before it — hydration
 * failures, a chunk that would not fetch — which is exactly the window the
 * errors worth seeing come from. Uncaught errors and unhandled rejections are
 * buffered through reportError from here, replayed the moment the SDK boots,
 * then these listeners are detached in favour of PostHog's (initAnalytics).
 */
export function bootAnalytics(root?: Document, load?: SdkLoader): Promise<void> {
  const doc = root ?? (typeof document !== 'undefined' ? document : undefined);
  if (!doc) return Promise.resolve();
  const meta = (name: string) =>
    doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.getAttribute('content') ?? undefined;
  const token = meta('ph-token');
  const host = meta('ph-host');
  if (!token || !host) return Promise.resolve();
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  if (win && !stopEarlyErrors) {
    // Buffering has to start now, not when the SDK load is scheduled: onError
    // fires straight into pending (see send), which nothing resets until the
    // SDK arrives or fails.
    pending ??= [];
    const onError = (event: ErrorEvent) => reportError(event.error ?? new Error(event.message));
    const onRejection = (event: PromiseRejectionEvent) => reportError(event.reason);
    win.addEventListener('error', onError);
    win.addEventListener('unhandledrejection', onRejection);
    stopEarlyErrors = () => {
      win.removeEventListener('error', onError);
      win.removeEventListener('unhandledrejection', onRejection);
    };
  }
  // Tests drive this synchronously; the browser waits for the visitor.
  if (root || load) return initAnalytics(token, host, load);
  scheduleSdkLoad(() => void initAnalytics(token, host), win ?? window);
  return Promise.resolve();
}
