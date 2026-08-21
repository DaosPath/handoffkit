#!/usr/bin/env node
/**
 * Run pnpm's production dependency audit and archive the machine-readable
 * result. High/critical advisories fail this gate; no advisory is evidence
 * only for the installed dependency graph, not a CodeQL review.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputPath = path.resolve(
  root,
  process.env.HANDOFFKIT_DEPENDENCY_AUDIT_OUTPUT
    || path.join("reports", "BROWSER_1.20_DEPENDENCY_AUDIT.json"),
);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function runAudit() {
  return new Promise((resolve, reject) => {
    const windows = process.platform === "win32";
    const child = spawn(
      windows ? process.env.ComSpec : pnpm,
      windows
        ? ["/d", "/s", "/c", `${pnpm} audit --prod --audit-level=high --json`]
        : ["audit", "--prod", "--audit-level=high", "--json"],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"], shell: false },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code: code ?? 1, signal, stdout, stderr }));
  });
}

function parseJson(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }
}

const result = await runAudit();
const audit = parseJson(result.stdout);
const vulnerabilities = audit?.metadata?.vulnerabilities || {};
const high = Number(vulnerabilities.high || 0);
const critical = Number(vulnerabilities.critical || 0);
const report = {
  format: "handoffkit.browser.1.20.dependency_audit",
  format_version: 1,
  generated_at: new Date().toISOString(),
  status: result.code === 0 && audit && high === 0 && critical === 0 ? "pass" : "fail",
  command: "pnpm audit --prod --audit-level=high --json",
  advisories: audit?.advisories || {},
  metadata: audit?.metadata || null,
  stderr: String(result.stderr || "").trim().slice(0, 2000),
  notice: "Dependency graph audit only. It does not replace CodeQL, source review, or hosted security evidence.",
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (report.status !== "pass") process.exitCode = 1;
