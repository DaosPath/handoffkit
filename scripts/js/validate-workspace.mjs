import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..", "..");
const packageNames = ["core", "providers", "node", "recipes", "templates", "cli"];
const manifests = [];

function fail(message) {
  throw new Error(`workspace validation: ${message}`);
}

for (const short of packageNames) {
  const packageRoot = path.join(root, "packages", "js", short);
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  manifests.push({ short, packageRoot, manifest });
}

const versions = new Set(manifests.map(({ manifest }) => manifest.version));
if (versions.size !== 1) fail(`public package versions differ: ${[...versions].join(", ")}`);

const names = new Set();
for (const { short, packageRoot, manifest } of manifests) {
  if (names.has(manifest.name)) fail(`duplicate package name ${manifest.name}`);
  names.add(manifest.name);
  if (manifest.name !== `@handoffkit/${short}`) fail(`${short}: unexpected name ${manifest.name}`);
  if (manifest.license !== "MIT") fail(`${manifest.name}: license must be MIT`);
  if (manifest.type !== "module") fail(`${manifest.name}: type must be module`);
  if (manifest.sideEffects !== false) fail(`${manifest.name}: sideEffects must be false`);
  if (manifest.repository?.directory !== `packages/js/${short}`) fail(`${manifest.name}: repository.directory mismatch`);
  if (!manifest.files?.includes("src") || !manifest.files?.includes("README.md")) fail(`${manifest.name}: files must include src and README.md`);
  if (!manifest.scripts?.check || !manifest.scripts?.test || !manifest.scripts?.prepack) fail(`${manifest.name}: missing quality scripts`);
  for (const [section, dependencies] of Object.entries({
    dependencies: manifest.dependencies,
    optionalDependencies: manifest.optionalDependencies,
    peerDependencies: manifest.peerDependencies,
  })) {
    for (const [dependency, range] of Object.entries(dependencies ?? {})) {
      if (dependency.startsWith("@handoffkit/") && !String(range).startsWith("workspace:")) {
        fail(`${manifest.name}: ${section}.${dependency} must use workspace protocol`);
      }
    }
  }
  for (const target of [manifest.types, manifest.main, manifest.exports?.["."]?.types, manifest.exports?.["."]?.import, manifest.exports?.["."]?.default]) {
    if (!target) fail(`${manifest.name}: missing entrypoint metadata`);
    const info = await stat(path.resolve(packageRoot, target));
    if (!info.isFile()) fail(`${manifest.name}: missing entrypoint ${target}`);
  }
  const module = await import(`${pathToFileURL(path.resolve(packageRoot, manifest.exports["."].import)).href}?validate=${Date.now()}`);
  if (Object.keys(module).length === 0) fail(`${manifest.name}: public entrypoint has no exports`);
  const runtimeVersion = short === "core"
    ? module.HANDOFFKIT_CORE_VERSION
    : short === "providers"
      ? module.HANDOFFKIT_PROVIDERS_VERSION
      : short === "cli"
        ? module.VERSION
        : undefined;
  if (runtimeVersion !== undefined && runtimeVersion !== manifest.version) {
    fail(`${manifest.name}: runtime version ${runtimeVersion} does not match manifest ${manifest.version}`);
  }
}

const web = JSON.parse(await readFile(path.join(root, "apps", "web", "package.json"), "utf8"));
if (web.private !== true) fail("@handoffkit/web must stay private");
if (!web.scripts?.check || !web.scripts?.typecheck) fail("@handoffkit/web must define check and typecheck scripts");

console.log(`workspace validation passed: ${manifests.length} public packages at ${[...versions][0]} + web app`);
