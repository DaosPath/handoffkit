#!/usr/bin/env node
/**
 * Production dependency audit via OSV.dev (https://osv.dev).
 *
 * The npm registry bulk-audit endpoint is unreliable from CI sandboxes, so
 * this gate resolves the exact prod graph (`pnpm list --json`) and queries
 * OSV once. CVSS >= 9 counts as critical, >= 7 as high; anything at/above
 * high fails the gate. Unknown service errors fail closed as "error".
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputPath = path.resolve(
  root,
  process.env.HANDOFFKIT_DEPENDENCY_AUDIT_OUTPUT
    || path.join("reports", "BROWSER_1.20_DEPENDENCY_AUDIT.json"),
);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function listProdGraph() {
  const windows = process.platform === "win32";
  const run = spawnSync(
    windows ? process.env.ComSpec : pnpm,
    windows ? ["/d", "/s", "/c", "pnpm list --json --prod --depth Infinity"] : ["list", "--json", "--prod", "--depth", "Infinity"],
    { cwd: root, encoding: "utf8", shell: false, maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.status !== 0) throw new Error(`pnpm list failed: ${String(run.stderr || "").slice(0, 500)}`);
  return JSON.parse(String(run.stdout || "[]"));
}

function collectPackages(importers) {
  const seen = new Map();
  const walk = (deps) => {
    for (const [name, info] of Object.entries(deps ?? {})) {
      if (!info || typeof info !== "object") continue;
      const version = String(info.version ?? "");
      if (name && version && !seen.has(`${name}@${version}`)) seen.set(`${name}@${version}`, { name, version });
      walk(info.dependencies);
    }
  };
  for (const importer of importers ?? []) {
    walk(importer.dependencies);
    walk(importer.optionalDependencies);
  }
  return [...seen.values()];
}

function maxCvss(vuln) {
  let best = 0;
  for (const entry of vuln?.severity ?? []) {
    if (typeof entry?.score === "string" && entry.type?.startsWith("CVSS")) {
      const value = Number(entry.score);
      if (Number.isFinite(value) && value > best) best = value;
    }
  }
  const labeled = String(vuln?.database_specific?.severity ?? "").toUpperCase();
  if (labeled === "CRITICAL") best = Math.max(best, 9);
  else if (labeled === "HIGH") best = Math.max(best, 7);
  return best;
}

const graph = listProdGraph();
const packages = collectPackages(graph);
const response = await fetch("https://api.osv.dev/v1/querybatch", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    queries: packages.map(({ name, version }) => ({ package: { name, ecosystem: "npm" }, version })),
  }),
});
if (!response.ok) throw new Error(`OSV querybatch failed: HTTP ${response.status}`);
const batch = await response.json();
const advisories = {};
for (let index = 0; index < packages.length; index += 1) {
  const { name, version } = packages[index];
  for (const vuln of batch?.results?.[index]?.vulns ?? []) {
    const score = maxCvss(vuln);
    const id = vuln.id || `${name}@${version}`;
    advisories[id] = {
      package: `${name}@${version}`,
      severity: score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "moderate" : "low",
      cvss: score,
      summary: String(vuln.summary ?? "").slice(0, 300),
      aliases: vuln.aliases ?? [],
    };
  }
}
const high = Object.values(advisories).filter((item) => item.severity === "high").length;
const critical = Object.values(advisories).filter((item) => item.severity === "critical").length;
const report = {
  format: "handoffkit.browser.1.20.dependency_audit",
  format_version: 2,
  generated_at: new Date().toISOString(),
  status: high === 0 && critical === 0 ? "pass" : "fail",
  command: "osv.dev querybatch over pnpm prod graph",
  packages_audited: packages.length,
  advisories,
  notice: "Dependency graph audit only. It does not replace CodeQL, source review, or hosted security evidence.",
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`audited ${packages.length} packages: high=${high} critical=${critical} status=${report.status}`);
if (report.status !== "pass") process.exitCode = 1;
