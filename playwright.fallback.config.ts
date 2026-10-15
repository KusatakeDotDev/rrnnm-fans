import { defineConfig } from '@playwright/test';
import config from './playwright.config';

export default defineConfig({
  ...config,
  projects: [
    { name: 'fallback', testDir: 'tests/fallback', use: config.projects![1]!.use },
    ...(process.env['TEST_BUILD_SCENARIO'] === 'no-maxres' ? [{
      name: 'hq-thumbnail', testDir: 'tests/conformance', testMatch: /schedule-thumbnail\.spec\.ts/,
      use: config.projects![1]!.use,
    }] : []),
  ],
});
