import { join } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import { build } from "astro";

import unreleased from "../../../src/integrations/unreleased.ts";

const dir = process.argv[2];
await build({
  root: dir,
  configFile: false,
  site: "https://example.com",
  integrations: [react(), sitemap(), unreleased()],
  srcDir: fileURLToPath(new URL("./src/", import.meta.url)),
  outDir: join(dir, "dist"),
  cacheDir: join(dir, "cache"),
  publicDir: join(dir, "public"),
  logLevel: "silent",
});
