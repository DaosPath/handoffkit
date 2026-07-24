import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const sourceRoots = ["src", "test", "examples"];
const extensions = new Set([".js", ".mjs", ".cjs"]);
const files = [];

async function walk(relative) {
  const absolute = path.join(root, relative);
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) await walk(child);
    else if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(child);
  }
}

for (const sourceRoot of sourceRoots) await walk(sourceRoot);
if (files.length === 0) throw new Error(`${manifest.name}: no JavaScript files found`);

for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`${manifest.name}: syntax check failed for ${file}`);
  }
}

const publicExport = manifest.exports?.["."];
for (const key of ["types", "import", "default"]) {
  const target = publicExport?.[key];
  if (!target) throw new Error(`${manifest.name}: exports[\".\"].${key} is required`);
  const info = await stat(path.resolve(root, target));
  if (!info.isFile()) throw new Error(`${manifest.name}: export target is not a file: ${target}`);
}

for (const [name, target] of Object.entries(manifest.bin ?? {})) {
  const absolute = path.resolve(root, target);
  const text = await readFile(absolute, "utf8");
  if (!text.startsWith("#!")) throw new Error(`${manifest.name}: bin ${name} needs a shebang`);
}

console.log(`${manifest.name}: checked ${files.length} JavaScript files and package exports`);
