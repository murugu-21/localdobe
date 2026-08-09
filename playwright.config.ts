import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/fixtures.setup.ts',
  timeout: 120_000,
  use: { baseURL: 'http://localhost:4321' },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Astro 7's `astro preview` auto-detects agentic shells (e.g. Claude Code, Cursor)
    // via `am-i-vibing` and silently forks itself into a background daemon in that case,
    // which makes the spawned process exit immediately — Playwright then reports
    // "Process from config.webServer exited early" even though the daemon is healthy.
    // Setting ASTRO_PREVIEW_BACKGROUND forces the normal blocking foreground server
    // regardless of the calling shell. See node_modules/astro/dist/cli/preview/index.js.
    env: { ASTRO_PREVIEW_BACKGROUND: '1' },
  },
});
