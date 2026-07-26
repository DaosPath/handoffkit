import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalUrl } from "./util.js";

function hashKey(url) {
  return createHash("sha256").update(canonicalUrl(url)).digest("hex").slice(0, 32);
}

/** Optional on-disk cache for fetched page markdown / bodies. */
export class BrowserCache {
  constructor({ root = "", ttlMs = 24 * 60 * 60 * 1000 } = {}) {
    this.root = root ? path.resolve(root) : "";
    this.ttlMs = ttlMs;
    this.enabled = Boolean(this.root);
  }

  async get(url) {
    if (!this.enabled) return null;
    const file = path.join(this.root, `${hashKey(url)}.json`);
    try {
      const raw = JSON.parse(await readFile(file, "utf8"));
      if (!raw || typeof raw !== "object") return null;
      if (this.ttlMs > 0 && Date.now() - Number(raw.saved_at || 0) > this.ttlMs) return null;
      return raw;
    } catch {
      return null;
    }
  }

  async set(url, payload = {}) {
    if (!this.enabled) return false;
    await mkdir(this.root, { recursive: true });
    const file = path.join(this.root, `${hashKey(url)}.json`);
    const body = {
      url: canonicalUrl(url),
      saved_at: Date.now(),
      ...payload,
    };
    await writeFile(file, JSON.stringify(body), "utf8");
    return true;
  }
}

export function defaultCacheRoot() {
  return path.resolve(process.cwd(), ".cache", "handoffkit-browser");
}
