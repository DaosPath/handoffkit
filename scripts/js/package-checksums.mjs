#!/usr/bin/env node
/**
 * Produce SHA-256 manifests for the exact JS tarballs emitted on this host.
 *
 * The manifest is evidence for one platform/architecture only. It never
 * substitutes for the hosted matrix: every runner must execute this script
 * and upload its own JSON artifact.
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageNames = [
  "core",
  "csp",
  "providers",
  "node",
  "browser-core",
  "browser",
  "browser-lite",
  "browser-real",
  "clinical",
  "recipes",
  "templates",
  "cli",
];
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const platform = process.platform;
const architecture = process.arch;
const outputPath = path.resolve(
  root,
  process.env.HANDOFFKIT_PACKAGE_CHECKSUMS_OUTPUT
    || path.join("reports", `BROWSER_1.20_PACKAGE_CHECKSUMS_${platform}_${architecture}.json`),
);

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const windows = process.platform === "win32";
    const windowsQuote = (value) => {
      if (!/[\s&"()<>^|]/.test(value)) return value;
      return `"${value.replaceAll('"', '\\"')}"`;
    };
    const child = spawn(
      windows ? process.env.ComSpec : pnpm,
      windows ? ["/d", "/s", "/c", [pnpm, ...args].map(windowsQuote).join(" ")] : args,
      { cwd, stdio: ["ignore", "pipe", "pipe"], shell: false },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`pnpm ${args.join(" ")} failed (${code ?? signal})\n${stdout}\n${stderr}`));
    });
  });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

await mkdir(path.join(root, ".local-tests"), { recursive: true });
const tempRoot = await mkdtemp(path.join(root, ".local-tests", "package-checksums-"));
const artifacts = [];
try {
  for (const shortName of packageNames) {
    const packageRoot = path.join(root, "packages", "js", shortName);
    const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
    const destination = path.join(tempRoot, shortName);
    await mkdir(destination, { recursive: true });
    await run(["--dir", packageRoot, "pack", "--pack-destination", destination], root);
    const archives = (await readdir(destination)).filter((name) => name.endsWith(".tgz"));
    if (archives.length !== 1) {
      throw new Error(`${manifest.name}: expected one tarball, found ${archives.join(", ")}`);
    }
    const archiveName = archives[0];
    const archivePath = path.join(destination, archiveName);
    const bytes = await readFile(archivePath);
    artifacts.push({
      name: manifest.name,
      version: manifest.version,
      filename: archiveName,
      bytes: (await stat(archivePath)).size,
      sha256: sha256(bytes),
    });
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

const report = {
  format: "handoffkit.browser.1.20.package_checksums",
  format_version: 1,
  generated_at: new Date().toISOString(),
  status: "pass",
  environment: {
    platform,
    architecture,
    node: process.version,
    pnpm: process.env.npm_config_user_agent || "unknown",
    os: `${os.type()} ${os.release()}`,
  },
  package_count: artifacts.length,
  artifacts,
  notice: "Checksums cover only tarballs produced on this runner. Cross-architecture release evidence requires one archived report per hosted architecture.",
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
