import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const mapPath = path.join(root, "docs", "roadmap", "repository-path-map.json");
const map = JSON.parse(await readFile(mapPath, "utf8"));

if (map.format !== "handoffkit.repository-path-map" || map.format_version !== 1) {
  throw new Error("repository path map format is unsupported");
}
if (map.phase !== "wave-0-inventory" || !Array.isArray(map.entries) || map.entries.length === 0) {
  throw new Error("repository path map must describe the Wave 0 inventory");
}

const seen = new Set();
for (const entry of map.entries) {
  if (!entry || typeof entry.current !== "string" || typeof entry.target !== "string") {
    throw new Error("repository path map entry is invalid");
  }
  const current = entry.current.replaceAll("\\", "/");
  const target = entry.target.replaceAll("\\", "/");
  if (!current || current.startsWith("/") || current.split("/").includes("..")) {
    throw new Error(`unsafe current repository path: ${entry.current}`);
  }
  if (!target || target.startsWith("/") || target.split("/").includes("..")) {
    throw new Error(`unsafe target repository path: ${entry.target}`);
  }
  if (seen.has(current)) throw new Error(`duplicate current repository path: ${current}`);
  seen.add(current);
  try {
    const metadata = await stat(path.join(root, ...current.split("/")));
    if (!metadata.isDirectory() && !metadata.isFile()) {
      throw new Error("not a regular file or directory");
    }
  } catch (error) {
    throw new Error(`mapped current path is missing: ${current}`, { cause: error });
  }
}

process.stdout.write(`repository path inventory: ${map.entries.length} current paths validated\n`);
