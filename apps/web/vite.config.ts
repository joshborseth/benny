import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const config = defineConfig({
  envDir: monorepoRoot,
  // Expose CONVEX_URL (exact prefix) without leaking CONVEX_DEPLOY_KEY etc.
  envPrefix: ["VITE_", "CONVEX_URL"],
  resolve: { tsconfigPaths: true },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
});

export default config;
