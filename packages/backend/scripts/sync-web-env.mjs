import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendEnvPath = resolve(root, ".env.local");
const webEnvPath = resolve(root, "../../apps/web/.env.local");

if (!existsSync(backendEnvPath)) {
  console.error("Missing packages/backend/.env.local — run convex setup first");
  process.exit(1);
}

const backendEnv = readFileSync(backendEnvPath, "utf8");
const urlMatch = backendEnv.match(/^CONVEX_URL=(.+)$/m);
if (!urlMatch) {
  console.error("CONVEX_URL not found in packages/backend/.env.local");
  process.exit(1);
}

const convexUrl = urlMatch[1].trim();
const lines = backendEnv.split("\n").filter((line) => !line.startsWith("VITE_CONVEX_URL="));

lines.push(`VITE_CONVEX_URL=${convexUrl}`);
writeFileSync(webEnvPath, `${lines.join("\n").trimEnd()}\n`);
console.log("Synced VITE_CONVEX_URL to apps/web/.env.local");
