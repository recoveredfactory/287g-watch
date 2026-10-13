import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/postcss";
import autoprefixer from "autoprefixer";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

export default defineConfig({
  envDir: repoRoot,
  envPrefix: ["VITE_", "PUBLIC_"],
  // Build timestamp, frozen at build time and surfaced in the footer as a
  // quiet "last deployed" flag — a data-refresh run that redeploys bumps it.
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    cors: true,
  },
  // Emit JSON imports as JSON.parse("…"), not object literals: the server
  // bundles the /data/dist files (lib/server/staticData.ts), and parsing the
  // 4.4 MB agency index that way is ~3x faster on a cold start.
  json: {
    stringify: true,
  },
  plugins: [
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/lib/paraglide",
      strategy: ["url", "preferredLanguage", "baseLocale"],
      urlPatterns: [
        {
          pattern: "/:path(.*)?",
          localized: [
            ["en", "/en/:path(.*)?"],
            ["es", "/es/:path(.*)?"],
          ],
        },
      ],
    }),
    sveltekit(),
  ],
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },
});
