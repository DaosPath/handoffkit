/**
 * Opt-in workspace web index. This is never a full-Internet index.
 * SQLite FTS5 is used when node:sqlite or better-sqlite3 is available;
 * otherwise a SHA-256 addressed JSON store is used and advertised as such.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";

export const PROJECT_INDEX_SCHEMA_VERSION = 1;
export const PROJECT_INDEX_DISCLAIMER =
  "project_index is an opt-in workspace document index, not a complete index of the Internet.";

function sha256(text) {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

function tokens(text) {
  return String(text ?? "").toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
}

function scoreDocument(doc, queryTokens) {
  const hay = `${doc.title} ${doc.markdown} ${doc.url}`.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (hay.includes(token)) score += 1;
  }
  return score;
}

function emptyState() {
  return {
    schema_version: PROJECT_INDEX_SCHEMA_VERSION,
    disclaimer: PROJECT_INDEX_DISCLAIMER,
    backend: "json",
    documents: [],
    quarantined: [],
  };
}

async function trySqlite(dbPath) {
  try {
    const mod = await import("better-sqlite3");
    const Database = mod.default;
    const db = new Database(dbPath);
    return { kind: "fts5", db, close: () => db.close() };
  } catch {
    return null;
  }
}

function ensureSqliteSchema(db) {
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  db.exec(`CREATE TABLE IF NOT EXISTS documents (
    document_id TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL UNIQUE,
    url TEXT,
    final_url TEXT,
    title TEXT,
    host TEXT,
    fetched_at TEXT,
    indexed_at TEXT,
    bytes INTEGER,
    content_type TEXT,
    markdown TEXT,
    provenance TEXT,
    quarantined INTEGER DEFAULT 0
  );`);
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      title, markdown, url, content='documents', content_rowid='rowid'
    );`);
  } catch {
    // FTS5 compile option missing
  }
  const version = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  if (!version) {
    db.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', ?)").run(String(PROJECT_INDEX_SCHEMA_VERSION));
  }
}

export class ProjectWebIndex {
  constructor(options = {}) {
    this.root = options.root ? path.resolve(options.root) : "";
    this.enabled = Boolean(options.enabled);
    this.maxDocuments = Number(options.maxDocuments ?? options.max_documents ?? 5000) || 5000;
    this.maxBytes = Number(options.maxBytes ?? options.max_bytes ?? 50 * 1024 * 1024) || 50 * 1024 * 1024;
    this.allowHosts = [...(options.allowHosts ?? options.allow_hosts ?? [])];
    this.state = emptyState();
    this.sqlite = null;
    this.worker = options.worker ?? null;
  }

  static disclaimer() {
    return PROJECT_INDEX_DISCLAIMER;
  }

  async open() {
    if (!this.enabled) {
      this.state.backend = "unavailable";
      return this;
    }
    if (!this.root) throw new Error("project_index requires an explicit workspace root");
    await mkdir(this.root, { recursive: true });
    const dbPath = path.join(this.root, "project-index.sqlite");
    this.sqlite = await trySqlite(dbPath);
    if (this.sqlite) {
      ensureSqliteSchema(this.sqlite.db);
      this.state.backend = "fts5";
      return this;
    }
    const jsonPath = path.join(this.root, "project-index.json");
    try {
      this.state = JSON.parse(await readFile(jsonPath, "utf8"));
      this.state.backend = "json";
    } catch {
      this.state = emptyState();
    }
    return this;
  }

  async persist() {
    if (!this.enabled || this.sqlite) return;
    await mkdir(this.root, { recursive: true });
    await writeFile(path.join(this.root, "project-index.json"), JSON.stringify(this.state, null, 2), "utf8");
  }

  async ingest(record) {
    if (!this.enabled) return { ok: false, error_code: "index_unavailable" };
    const markdown = String(record.markdown ?? "");
    const digest = String(record.sha256 || sha256(markdown)).toLowerCase();
    const host = String(record.host || "").toLowerCase();
    if (this.allowHosts.length && host && !this.allowHosts.includes(host)) {
      return { ok: false, error_code: "policy_denied" };
    }
    const doc = {
      document_id: record.document_id || record.documentId || digest.slice(0, 16),
      sha256: digest,
      url: record.url || "",
      final_url: record.final_url || record.finalUrl || record.url || "",
      title: record.title || "",
      host,
      fetched_at: record.fetched_at || record.fetchedAt || new Date().toISOString(),
      indexed_at: new Date().toISOString(),
      bytes: Buffer.byteLength(markdown, "utf8"),
      content_type: record.content_type || record.contentType || "text/markdown",
      markdown,
      provenance: record.provenance || { product: "lite", source: "project_index" },
      quarantined: 0,
    };
    if (this.state.documents.length >= this.maxDocuments) {
      return { ok: false, error_code: "policy_denied", error: "document limit" };
    }
    const used = this.state.documents.reduce((sum, item) => sum + Number(item.bytes || 0), 0);
    if (used + doc.bytes > this.maxBytes) {
      return { ok: false, error_code: "policy_denied", error: "byte limit" };
    }
    if (this.sqlite) {
      try {
        const db = this.sqlite.db;
        db.prepare(`INSERT OR REPLACE INTO documents
          (document_id, sha256, url, final_url, title, host, fetched_at, indexed_at, bytes, content_type, markdown, provenance, quarantined)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`).run(
          doc.document_id, doc.sha256, doc.url, doc.final_url, doc.title, doc.host,
          doc.fetched_at, doc.indexed_at, doc.bytes, doc.content_type, doc.markdown, JSON.stringify(doc.provenance),
        );
        try {
          db.prepare("INSERT INTO documents_fts(title, markdown, url) VALUES (?, ?, ?)").run(doc.title, doc.markdown, doc.url);
        } catch {
          // FTS5 optional
        }
        return { ok: true, sha256: digest, backend: "fts5" };
      } catch {
        this.sqlite.close?.();
        this.sqlite = null;
        this.state.backend = "json";
      }
    }
    this.state.documents = this.state.documents.filter((item) => item.sha256 !== digest);
    this.state.documents.push(doc);
    await this.persist();
    return { ok: true, sha256: digest, backend: "json" };
  }

  async search(query, options = {}) {
    const maxResults = Number(options.maxResults ?? options.max_results ?? 8) || 8;
    if (!this.enabled) {
      return { hits: [], results: [], error_code: "index_unavailable", error: PROJECT_INDEX_DISCLAIMER };
    }
    const queryTokens = tokens(query);
    let docs = this.state.documents.filter((item) => !item.quarantined);
    if (this.sqlite) {
      try {
        const rows = this.sqlite.db.prepare(
          "SELECT document_id, title, url, final_url, markdown, sha256 FROM documents WHERE quarantined = 0",
        ).all();
        docs = rows;
      } catch {
        docs = [];
      }
    }
    const ranked = docs
      .map((doc) => ({ doc, score: scoreDocument(doc, queryTokens) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(({ doc, score }) => ({ title: doc.title || doc.url, url: doc.final_url || doc.url, score, sha256: doc.sha256 }));
    return { hits: ranked, results: ranked, backend: this.state.backend, disclaimer: PROJECT_INDEX_DISCLAIMER };
  }

  async integrityCheck() {
    const bad = [];
    for (const doc of this.state.documents) {
      if (sha256(doc.markdown) !== doc.sha256) {
        doc.quarantined = 1;
        this.state.quarantined.push(doc.document_id);
        bad.push(doc.document_id);
      }
    }
    if (bad.length) await this.persist();
    return { ok: bad.length === 0, quarantined: bad, backend: this.state.backend };
  }

  async exportDocuments() {
    return { disclaimer: PROJECT_INDEX_DISCLAIMER, documents: this.state.documents.map((doc) => ({ ...doc })) };
  }

  async deleteAll() {
    this.state = emptyState();
    this.state.backend = this.sqlite ? "fts5" : "json";
    if (this.root) await rm(path.join(this.root, "project-index.json"), { force: true });
    await this.persist();
    return { ok: true };
  }

  async close() {
    this.sqlite?.close?.();
    this.sqlite = null;
  }
}

export function createProjectWebIndex(options) {
  return new ProjectWebIndex(options);
}

if (!isMainThread && parentPort && workerData?.role === "project-index") {
  const index = new ProjectWebIndex(workerData.options || {});
  parentPort.on("message", async (message) => {
    try {
      if (message.op === "open") await index.open();
      else if (message.op === "ingest") parentPort.postMessage(await index.ingest(message.record));
      else if (message.op === "search") parentPort.postMessage(await index.search(message.query, message.options));
      else parentPort.postMessage({ error_code: "invalid_request" });
    } catch (error) {
      parentPort.postMessage({ error_code: "index_corrupt", error: String(error?.message ?? error) });
    }
  });
}

export function startProjectIndexWorker(options) {
  const filename = fileURLToPath(import.meta.url);
  return new Worker(filename, { workerData: { role: "project-index", options } });
}
