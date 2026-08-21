import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load monorepo-root .env into process.env for server routes
 * (NVIDIA_API_KEY, etc.) without exposing secrets to the client bundle.
 */
function loadMonorepoEnv() {
  const candidates = [
    resolve(__dirname, "../../.env"),
    resolve(__dirname, "../../.env.local"),
    resolve(__dirname, ".env.local"),
    resolve(__dirname, ".env"),
  ];

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

loadMonorepoEnv();

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow importing workspace package source (ESM).
  transpilePackages: ["@handoffkit/core"],
  serverExternalPackages: [],
};

export default nextConfig;
