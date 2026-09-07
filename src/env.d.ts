/// <reference types="astro/client" />
/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/info" />

interface ImportMetaEnv {
  /** Microsoft Clarity project ID; when unset, no analytics script is emitted. */
  readonly PUBLIC_CLARITY_PROJECT_ID?: string;
  /** PostHog browser analytics configuration. */
  readonly PUBLIC_POSTHOG_PROJECT_TOKEN?: string;
  readonly PUBLIC_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  posthog?: {
    capture: (event: string, properties?: Record<string, unknown>) => void;
  };
  /**
   * Microsoft Clarity's queue stub (see the snippet in `src/layouts/Base.astro`).
   * Called as clarity('event', name) and clarity('set', key, value) — tag values
   * must be strings, which is why `src/lib/analytics.ts` buckets every number.
   */
  clarity?: (...args: unknown[]) => void;
}
