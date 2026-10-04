import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "localdobe",
    compatibilityDate: "2026-08-01",
    domains: ["localdobe.com"],
  },
});
