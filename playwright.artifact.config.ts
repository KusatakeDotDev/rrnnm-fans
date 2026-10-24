import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

// scripts/test-ci.mjs の off 用。ページを開かないので、wrangler を立てない。
// unreleased.spec.ts は TEST_DIST を読まずに自分で fixture をビルドするので、on で1回回せば足りる。
export default defineConfig({
  ...config,
  webServer: undefined,
  projects: config
    .projects!.filter((project) => project.name === "artifact")
    .map((project) => ({
      ...project,
      testIgnore: /unreleased\.spec\.ts$/,
    })),
});
