import fs from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path, { join } from "node:path";

export * from "@handoffkit/core";
import {
  ContextDocument,
  RunTrace,
  buildContractParityReport,
} from "@handoffkit/core";

const DEFAULT_EXTENSIONS = new Set([".py", ".md", ".toml", ".json", ".txt", ".yaml", ".yml", ".js", ".ts"]);
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
]);

export class FileTraceStore {
  constructor({ root = "traces" } = {}) {
    this.root = root;
  }

  async save(trace, name = "") {
    const runTrace = trace instanceof RunTrace ? trace : RunTrace.fromJSON(trace);
    await mkdir(this.root, { recursive: true });
    const fileName = `${safeFileName(name || runTrace.runId)}.json`;
    const filePath = join(this.root, fileName);
    await writeFile(filePath, runTrace.toJSONString(2), "utf8");
    return filePath;
  }

  async load(nameOrPath) {
    const filePath = nameOrPath.endsWith(".json")
      ? nameOrPath
      : join(this.root, `${safeFileName(nameOrPath)}.json`);
    return RunTrace.fromJSON(await readFile(filePath, "utf8"));
  }

  async list() {
    try {
      const entries = await readdir(this.root, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => join(this.root, entry.name));
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }
}

export async function writeReportFiles(report, name, outputDir = "reports") {
  await mkdir(outputDir, { recursive: true });
  const base = join(outputDir, safeFileName(name));
  const jsonPath = `${base}.json`;
  const markdownPath = `${base}.md`;
  const data = report?.toJSON?.() ?? report;
  const markdown = report?.toMarkdown?.() ?? `# ${name}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
  await writeFile(jsonPath, JSON.stringify(data, null, 2), "utf8");
  await writeFile(markdownPath, markdown, "utf8");
  return { jsonPath, markdownPath };
}

export async function loadReportJSON(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function buildNodeContractParityReport({
  runtime = "node",
  version = "1.14.0",
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
  constructor({ root = ".", allowedExtensions = null, maxFileSize = 64000 } = {}) {
    this.root = root;
    this.allowedExtensions = allowedExtensions ? new Set(allowedExtensions) : DEFAULT_EXTENSIONS;
    this.maxFileSize = maxFileSize;
  }

  index() {
    const docs = [];
    const walk = (dir) => {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relative = path.relative(this.root, fullPath);

        const parts = relative.split(path.sep);
        const isIgnored = parts.some((part) => IGNORED_DIRS.has(part) || part.endsWith(".egg-info"));
        if (isIgnored) continue;

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (!this.allowedExtensions.has(ext)) continue;

          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > this.maxFileSize) continue;

            const content = fs.readFileSync(fullPath, "utf8");
            const lines = content.split(/\r?\n/);
            const summary = this._summarize(entry.name, ext, lines, stat.size, content);

            docs.push(new ContextDocument({
              path: relative.replace(/\\/g, "/"),
              content,
              summary,
              metadata: {
                extension: ext,
                size: stat.size,
                lineCount: lines.length,
              },
            }));
          } catch (_) {
            // Ignore stat or read errors.
          }
        }
      }
    };

    walk(this.root);
    return docs.sort((a, b) => a.path.localeCompare(b.path));
  }

  _summarize(name, ext, lines, _size, content) {
    const previewLines = lines.slice(0, 3).map((line) => line.trim()).filter(Boolean);
    const preview = previewLines.join(" ");
    return `${name}: ${lines.length} lines, ${Buffer.byteLength(content, "utf8")} bytes, extension ${ext}. ${preview}`.trim();
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

function safeFileName(value) {
  return String(value || "report").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "report";
}

import { MemoryStore, MemoryItem } from "@handoffkit/core";

export class JsonMemoryStore extends MemoryStore {
  constructor(filePath) {
    if (!filePath) throw new Error("filePath is required for JsonMemoryStore");
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "[]", "utf8");
    }
    const raw = fs.readFileSync(filePath, "utf8").trim();
    let items = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          throw new Error("JSON memory store must contain a list");
        }
        items = parsed.map(item => MemoryItem.fromDict(item));
      } catch (error) {
        throw new Error(`Invalid JSON memory store: ${filePath} (${error.message})`);
      }
    }
    super({ items });
    this.filePath = filePath;
  }

  _save() {
    if (!this.filePath) return;
    const serialized = JSON.stringify(this.list().map(item => item.toDict()), null, 2);
    fs.writeFileSync(this.filePath, serialized, "utf8");
  }
}
