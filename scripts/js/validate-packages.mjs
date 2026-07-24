import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";

const root = path.resolve(import.meta.dirname, "..", "..");
const packageNames = ["core", "providers", "node", "recipes", "templates", "cli"];
const pnpmCli = process.env.npm_execpath;

if (!pnpmCli) {
  throw new Error("package validation must run through pnpm so npm_execpath is available");
}

function parseOctal(buffer, start, length) {
  const raw = buffer.subarray(start, start + length).toString("utf8").replaceAll("\0", "").trim();
  return raw ? Number.parseInt(raw, 8) : 0;
}

function readText(buffer, start, length) {
  return buffer.subarray(start, start + length).toString("utf8").replaceAll("\0", "").trim();
}

function parseTar(gzipBuffer) {
  const buffer = gunzipSync(gzipBuffer);
  const entries = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = readText(header, 0, 100);
    const prefix = readText(header, 345, 155);
    const size = parseOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const linkname = readText(header, 157, 100);
    const fullName = prefix ? `${prefix}/${name}` : name;
    entries.push({ name: fullName.replace(/^package\//, ""), size, type, linkname });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

for (const short of packageNames) {
  const packageRoot = path.join(root, "packages", "js", short);
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const destination = await mkdtemp(path.join(tmpdir(), `handoffkit-pack-${short}-`));
  try {
    const result = spawnSync(
      process.execPath,
      [pnpmCli, "--dir", packageRoot, "pack", "--json", "--pack-destination", destination],
      { cwd: root, encoding: "utf8", stdio: "pipe" },
    );
    if (result.status !== 0) {
      process.stderr.write(result.stdout || "");
      process.stderr.write(result.stderr || "");
      if (result.error) process.stderr.write(`${result.error}\n`);
      throw new Error(`${manifest.name}: pnpm pack failed`);
    }

    const archives = (await readdir(destination)).filter((name) => name.endsWith(".tgz"));
    if (archives.length !== 1) {
      throw new Error(`${manifest.name}: expected one tarball, found ${archives.length}`);
    }
    const archivePath = path.join(destination, archives[0]);
    const archiveInfo = await stat(archivePath);
    if (archiveInfo.size > 2_000_000) {
      throw new Error(`${manifest.name}: tarball exceeds 2 MB (${archiveInfo.size} bytes)`);
    }

    const entries = parseTar(await readFile(archivePath));
    const files = new Map(entries.filter((entry) => entry.type === "0" || entry.type === "\0").map((entry) => [entry.name, entry]));
    for (const entry of entries) {
      if (entry.type === "1" || entry.type === "2") {
        throw new Error(`${manifest.name}: tarball contains link ${entry.name} -> ${entry.linkname}`);
      }
    }
    for (const required of ["package.json", "README.md", "src/index.js", "src/index.d.ts"]) {
      const entry = files.get(required);
      if (!entry) throw new Error(`${manifest.name}: tarball missing ${required}`);
      if (entry.size === 0) throw new Error(`${manifest.name}: tarball contains empty ${required}`);
    }
    for (const [file, entry] of files) {
      if (
        file.startsWith("test/") ||
        file.startsWith("examples/") ||
        file.endsWith(".env") ||
        file.includes("index.monolith") ||
        file.endsWith("split.mjs")
      ) {
        throw new Error(`${manifest.name}: forbidden tarball file ${file}`);
      }
      if ((file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".d.ts")) && entry.size === 0) {
        throw new Error(`${manifest.name}: tarball contains empty code file ${file}`);
      }
    }
    console.log(`${manifest.name}: ${files.size} files, ${archiveInfo.size} packed bytes, no links`);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
}
