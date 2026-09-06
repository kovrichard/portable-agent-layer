/**
 * The control room's build. Bun serves the page and owns every API route, but
 * Bun's CSS bundler passes Tailwind's directives through as unknown at-rules —
 * so the page is built here, by the first-party plugin that moves in lockstep
 * with Tailwind itself, and Bun serves the result out of dist/.
 *
 * `server.proxy` is what makes `bun run dev:ui` usable: the page comes from Vite
 * with hot reload while every /api call goes to the real control room.
 */

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Mirrors DEFAULT_PORT in ../server-config.ts. A config the loader reads before
 * TypeScript resolution cannot import from the source tree, so a test asserts
 * the two agree.
 */
const API_ORIGIN = "http://127.0.0.1:7250";

export default defineConfig({
  root: import.meta.dirname,
  base: "/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    proxy: {
      "/api": API_ORIGIN,
    },
  },
});
