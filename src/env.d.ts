/// <reference types="astro/client" />
/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/info" />

interface ImportMetaEnv {
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
}
