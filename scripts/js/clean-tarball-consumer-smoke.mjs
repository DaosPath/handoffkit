import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const smokeRoot = join(root, ".local-tests", "js-tarball-consumer");
const archiveRoot = join(smokeRoot, "archives");
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

function windowsQuote(value) {
  if (!/[\s"&()<>^|]/.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const windows = process.platform === "win32";
    const child = spawn(
      windows ? process.env.ComSpec : command,
      windows ? ["/d", "/s", "/c", [command, ...args].map(windowsQuote).join(" ")] : args,
      {
        cwd,
        env: { ...process.env, CI: process.env.CI || "1" },
        stdio: "inherit",
        shell: false,
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} ${args.join(" ")} failed (${code ?? signal})`));
    });
  });
}

await rm(smokeRoot, { recursive: true, force: true });
await mkdir(archiveRoot, { recursive: true });

const manifests = [];
for (const shortName of packageNames) {
  const packageRoot = join(root, "packages", "js", shortName);
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  await run(pnpm, ["--dir", packageRoot, "pack", "--pack-destination", archiveRoot], root);
  const slug = manifest.name.replace(/^@/, "").replace("/", "-");
  const archives = (await readdir(archiveRoot)).filter(
    (name) => name.startsWith(`${slug}-${manifest.version}.`) && name.endsWith(".tgz"),
  );
  if (archives.length !== 1) {
    throw new Error(`${manifest.name}: expected one ${slug}-${manifest.version}.tgz artifact, found ${archives.join(", ")}`);
  }
  manifests.push({ shortName, manifest, archive: archives[0] });
}

const dependencies = Object.fromEntries(
  manifests.map(({ manifest, archive }) => [manifest.name, `file:archives/${archive}`]),
);
const overrides = Object.fromEntries(
  manifests.map(({ manifest, archive }) => [manifest.name, `file:archives/${archive}`]),
);
await writeFile(
  join(smokeRoot, "package.json"),
  `${JSON.stringify({ name: "handoffkit-js-tarball-consumer", private: true, type: "module", dependencies }, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(smokeRoot, "pnpm-workspace.yaml"),
  `overrides:\n${Object.entries(overrides).map(([name, spec]) => `  '${name}': '${spec}'`).join("\n")}\n`,
  "utf8",
);
await writeFile(
  join(smokeRoot, "verify.mjs"),
  `import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\n\nconst packages = ${JSON.stringify(manifests.map(({ manifest }) => manifest.name))};\nconst modules = {\n${manifests.map(({ manifest }) => `  ${JSON.stringify(manifest.name)}: await import(${JSON.stringify(manifest.name)}),`).join("\n")}\n};\nfor (const name of packages) {\n  const metadata = JSON.parse(await readFile(new URL(\`node_modules/\${name}/package.json\`, import.meta.url), "utf8"));\n  assert.equal(metadata.name, name);\n  assert.ok(Object.keys(modules[name]).length > 0, \`\${name} exports no public symbols\`);\n  console.log(\`\${name}@\${metadata.version}: clean tarball import OK (\${Object.keys(modules[name]).length} exports)\`);\n}\n`,
  "utf8",
);

await run(pnpm, ["--dir", smokeRoot, "install", "--offline", "--frozen-lockfile=false"], root);
await run(pnpm, ["--dir", smokeRoot, "exec", "node", "verify.mjs"], root);
console.log(`JS clean tarball consumer smoke passed: ${manifests.length} packages`);
