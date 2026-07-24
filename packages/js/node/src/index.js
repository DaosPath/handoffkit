import fs from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path, { join } from "node:path";

export * from "@handoffkit/core";
import {
  ContextDocument,
  HANDOFFKIT_CORE_VERSION,
  MemoryItem,
  MemoryStore,
  RunTrace,
  buildContractParityReport,
} from "@handoffkit/core";

const DEFAULT_EXTENSIONS = new Set([".py", ".md", ".toml", ".json", ".txt", ".yaml", ".yml", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"]);
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  ".ruff_cache",
  ".next",
  ".turbo",
  "coverage",
]);

export class FileTraceStore {
  constructor({ root = "traces" } = {}) {
    this.root = path.resolve(root);
  }

  async save(trace, name = "") {
    const runTrace = trace instanceof RunTrace ? trace : RunTrace.fromJSON(trace);
    const fileName = `${safeFileName(name || runTrace.runId)}.json`;
    const filePath = join(this.root, fileName);
    await atomicWriteFile(filePath, runTrace.toJSONString(2));
    return filePath;
  }

  async load(nameOrPath) {
    const value = String(nameOrPath || "");
    if (!value) throw new TypeError("nameOrPath must be a non-empty string");
    const filePath = value.endsWith(".json") ? path.resolve(value) : join(this.root, `${safeFileName(value)}.json`);
    return RunTrace.fromJSON(await readFile(filePath, "utf8"));
  }

  async list() {
    try {
      const entries = await readdir(this.root, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => join(this.root, entry.name))
        .sort();
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }
}

export async function writeReportFiles(report, name, outputDir = "reports") {
  const base = join(path.resolve(outputDir), safeFileName(name));
  const jsonPath = `${base}.json`;
  const markdownPath = `${base}.md`;
  const data = report?.toJSON?.() ?? report;
  const markdown = report?.toMarkdown?.() ?? `# ${name}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
  await Promise.all([
    atomicWriteFile(jsonPath, JSON.stringify(data, null, 2)),
    atomicWriteFile(markdownPath, markdown),
  ]);
  return { jsonPath, markdownPath };
}

export async function loadReportJSON(filePath) {
  const absolute = path.resolve(filePath);
  const source = await readFile(absolute, "utf8");
  try {
    return JSON.parse(source);
  } catch (cause) {
    throw new SyntaxError(`Invalid JSON report: ${absolute} (${cause.message})`, { cause });
  }
}

export async function buildNodeContractParityReport({
  runtime = "node",
  version = HANDOFFKIT_CORE_VERSION,
  contractsRoot = join(import.meta.dirname, "..", "..", "..", "contracts"),
  expectedFixtures,
  expectedSchemas,
} = {}) {
  const inventory = await readContractInventory(contractsRoot);
  return buildContractParityReport({
    runtime,
    version,
    contractsRoot,
    contractInventory: inventory,
    expectedFixtures,
    expectedSchemas,
  });
}

export async function readContractInventory(contractsRoot) {
  const [fixtures, schemas] = await Promise.all([
    readDirectoryNames(join(contractsRoot, "fixtures")),
    readDirectoryNames(join(contractsRoot, "schemas")),
  ]);
  return { fixtures, schemas };
}

export class ProjectIndexer {
  constructor({ root = ".", allowedExtensions = null, maxFileSize = 64000, maxFiles = 10000 } = {}) {
    this.root = path.resolve(root);
    this.allowedExtensions = new Set(
      (allowedExtensions ? [...allowedExtensions] : [...DEFAULT_EXTENSIONS]).map((extension) =>
        String(extension).toLowerCase().startsWith(".") ? String(extension).toLowerCase() : `.${String(extension).toLowerCase()}`,
      ),
    );
    this.maxFileSize = normalizePositiveInteger(maxFileSize, 64000);
    this.maxFiles = normalizePositiveInteger(maxFiles, 10000);
  }

  index() {
    const docs = [];
    const walk = (dir) => {
      if (docs.length >= this.maxFiles) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return;
      }
      for (const entry of entries) {
        if (docs.length >= this.maxFiles) break;
        if (entry.isSymbolicLink()) continue;
        const fullPath = path.join(dir, entry.name);
        const relative = path.relative(this.root, fullPath);
        const parts = relative.split(path.sep);
        const isIgnored = parts.some((part) => IGNORED_DIRS.has(part) || part.endsWith(".egg-info"));
        if (isIgnored) continue;

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const extension = path.extname(entry.name).toLowerCase();
          if (!this.allowedExtensions.has(extension)) continue;
          try {
            const fileStat = fs.statSync(fullPath);
            if (fileStat.size > this.maxFileSize) continue;
            const content = fs.readFileSync(fullPath, "utf8");
            const lines = content.split(/\r?\n/);
            docs.push(
              new ContextDocument({
                path: relative.replace(/\\/g, "/"),
                content,
                summary: this._summarize(entry.name, extension, lines, content),
                metadata: {
                  extension,
                  size: fileStat.size,
                  lineCount: lines.length,
                },
              }),
            );
          } catch (_) {
            // Ignore files that disappear or cannot be decoded while indexing.
          }
        }
      }
    };

    walk(this.root);
    return docs.sort((left, right) => left.path.localeCompare(right.path));
  }

  _summarize(name, extension, lines, content) {
    const preview = lines.slice(0, 3).map((line) => line.trim()).filter(Boolean).join(" ");
    return `${name}: ${lines.length} lines, ${Buffer.byteLength(content, "utf8")} bytes, extension ${extension}. ${preview}`.trim();
  }
}

export class JsonMemoryStore extends MemoryStore {
  constructor(filePath) {
    if (!filePath) throw new TypeError("filePath is required for JsonMemoryStore");
    const absolute = path.resolve(filePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    if (!fs.existsSync(absolute)) atomicWriteFileSync(absolute, "[]");
    const raw = fs.readFileSync(absolute, "utf8").trim();
    let items = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new TypeError("JSON memory store must contain a list");
        items = parsed.map((item) => MemoryItem.fromDict(item));
      } catch (cause) {
        throw new SyntaxError(`Invalid JSON memory store: ${absolute} (${cause.message})`, { cause });
      }
    }
    super({ items });
    this.filePath = absolute;
  }

  _save() {
    if (!this.filePath) return;
    const serialized = JSON.stringify(this.list().map((item) => item.toDict()), null, 2);
    atomicWriteFileSync(this.filePath, serialized);
  }
}

async function readDirectoryNames(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function atomicWriteFile(filePath, data) {
  const absolute = path.resolve(filePath);
  const directory = path.dirname(absolute);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${path.basename(absolute)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, data, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, absolute);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

function atomicWriteFileSync(filePath, data) {
  const absolute = path.resolve(filePath);
  const directory = path.dirname(absolute);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `.${path.basename(absolute)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, data, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, absolute);
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } catch (_) {}
  }
}

function safeFileName(value) {
  return String(value || "report").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "report";
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
