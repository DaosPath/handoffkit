/**
 * Curated source catalog for Browser 1.20.
 *
 * Not a search engine: the user curates pages (docs, bookmarks, history)
 * with categories and weights, and retrieval prefers higher weights.
 * Backed by sources.json next to a ProjectWebIndex root.
 *
 * Snake_case wire format mirrors the Python implementation exactly.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalSearchUrl } from "./search.js";

export const SOURCE_CATALOG_FORMAT = "handoffkit.browser.source_catalog";
export const SOURCE_CATALOG_VERSION = 1;

function cleanUrl(value) {
  return String(value ?? "").trim();
}

function cleanWeight(value) {
  const weight = Number(value ?? 1);
  if (!Number.isFinite(weight) || weight < 0) return 1;
  return weight;
}

export class SourceCatalog {
  constructor(root) {
    this.root = root ? path.resolve(root) : "";
    this.sources = [];
  }

  get file() {
    return path.join(this.root, "sources.json");
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, "utf8"));
      this.sources = Array.isArray(data?.sources) ? data.sources.filter((s) => s && typeof s.url === "string") : [];
    } catch {
      this.sources = [];
    }
    return this;
  }

  async save() {
    if (!this.root) throw new Error("source catalog requires a root");
    await mkdir(this.root, { recursive: true });
    await writeFile(
      this.file,
      `${JSON.stringify({ format: SOURCE_CATALOG_FORMAT, format_version: SOURCE_CATALOG_VERSION, sources: this.sources }, null, 2)}\n`,
      "utf8",
    );
    return this;
  }

  list({ category = "" } = {}) {
    const wanted = String(category ?? "").trim().toLowerCase();
    return this.sources
      .filter((source) => !wanted || String(source.category ?? "").toLowerCase() === wanted)
      .map((source) => ({ ...source }));
  }

  async add({ url, category = "", weight = 1, title = "", notes = "" } = {}) {
    const clean = cleanUrl(url);
    if (!/^https?:\/\//i.test(clean)) throw new Error("catalog url must be http(s)");
    const existing = this.sources.find((source) => source.url === clean);
    const record = {
      url: clean,
      category: String(category ?? "").trim().toLowerCase(),
      weight: cleanWeight(weight),
      title: String(title ?? ""),
      notes: String(notes ?? ""),
      added_at: existing?.added_at ?? new Date().toISOString(),
    };
    if (existing) Object.assign(existing, record);
    else this.sources.push(record);
    await this.save();
    return { ...record };
  }

  async remove(url) {
    const clean = cleanUrl(url);
    const before = this.sources.length;
    this.sources = this.sources.filter((source) => source.url !== clean);
    if (this.sources.length !== before) await this.save();
    return before !== this.sources.length;
  }

  async setWeight(url, weight) {
    const clean = cleanUrl(url);
    const found = this.sources.find((source) => source.url === clean);
    if (!found) return false;
    found.weight = cleanWeight(weight);
    await this.save();
    return true;
  }

  /**
   * Weighted retrieval over an open ProjectWebIndex. Score × weight,
   * weight 0 excludes, optional category scope. Fail-closed when empty.
   */
  async search(index, query, { category = "", minWeight = 0, maxResults = 8 } = {}) {
    const wanted = String(category ?? "").trim().toLowerCase();
    const eligible = this.sources.filter(
      (source) => source.weight > 0
        && source.weight >= minWeight
        && (!wanted || String(source.category ?? "").toLowerCase() === wanted),
    );
    if (!eligible.length) return { hits: [], results: [], error_code: "catalog_empty" };
    const byUrl = new Map();
    for (const source of eligible) {
      byUrl.set(source.url, source);
      byUrl.set(canonicalKey(source.url), source);
    }
    const found = await index.search(query, { maxResults: Math.max(eligible.length * 2, 8) });
    const hits = [];
    for (const hit of found.hits ?? found.results ?? []) {
      const source = byUrl.get(hit.url) ?? byUrl.get(canonicalKey(hit.url));
      if (!source) continue;
      hits.push({
        title: hit.title || hit.url,
        url: hit.url,
        score: Number(hit.score ?? 0) * source.weight,
        weight: source.weight,
        category: source.category,
        sha256: hit.sha256 ?? "",
      });
    }
    hits.sort((a, b) => b.weight - a.weight || b.score - a.score);
    const sliced = hits.slice(0, Math.max(1, maxResults));
    return { hits: sliced, results: sliced };
  }

  async ingestAll({ index, fetchMarkdown, transport = null, timeoutMs = 20000 } = {}) {
    if (typeof fetchMarkdown !== "function") throw new Error("ingestAll requires fetchMarkdown");
    const results = [];
    for (const source of this.sources) {
      try {
        const page = await fetchMarkdown(source.url, { transport, timeoutMs });
        const outcome = await index.ingest({
          url: source.url,
          title: source.title || page?.title || source.url,
          markdown: page?.markdown || "",
        });
        results.push({ url: source.url, ok: Boolean(outcome?.ok), error_code: outcome?.error_code ?? "" });
      } catch (error) {
        results.push({ url: source.url, ok: false, error_code: "ingest_failed", error: String(error?.message ?? error) });
      }
    }
    return results;
  }
}

function canonicalKey(url) {
  return canonicalSearchUrl(url);
}

export function createSourceCatalog(root) {
  return new SourceCatalog(root);
}
