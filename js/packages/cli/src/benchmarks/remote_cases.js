// On-demand loader for the large doctor-benchmark case sets (parity with the
// Python `handoffkit.benchmarks._remote_cases`). Only the 30-case set ships in
// the npm tarball; 100/400 come from the checkout, the cache, or a one-time
// download from a pinned commit verified by SHA-256.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PINNED_COMMIT = "e9522482609a90ed04933c9b1a006cc32fa25e58";
const REPO_PATH = "js/packages/cli/src/benchmarks";
const RAW_BASE = `https://raw.githubusercontent.com/DaosPath/handoffkit/${PINNED_COMMIT}/${REPO_PATH}`;

export const REMOTE_CASE_SETS = Object.freeze({
  "doctor_cases_100.json": "cedd0caddaa495a2729b810207b75f0ccf8b084b62c88b7c9b836182298117c6",
  "doctor_cases_400.json": "37f6481e8f61ebfd9bde55b9e2d44c9eec23eee23aef4c57359cec1a4e168b7a",
});

const LOCAL_DIR = dirname(fileURLToPath(import.meta.url));

export class CaseSetUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "CaseSetUnavailableError";
  }
}

export function caseCacheDir() {
  if (process.env.HANDOFFKIT_CACHE_DIR) return join(process.env.HANDOFFKIT_CACHE_DIR, "benchmarks");
  const base = process.platform === "win32"
    ? (process.env.LOCALAPPDATA || join(os.homedir(), "AppData", "Local"))
    : (process.env.XDG_CACHE_HOME || join(os.homedir(), ".cache"));
  return join(base, "handoffkit", "benchmarks");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function expectedHash(name) {
  const expected = REMOTE_CASE_SETS[name];
  if (!expected) throw new Error(`unknown case set: ${name}`);
  return expected;
}

/** Synchronous read from the checkout or a verified cache entry; null if absent. */
export function readCaseSetSync(name, { localDir = LOCAL_DIR } = {}) {
  const expected = expectedHash(name);
  const local = join(localDir, name);
  if (fs.existsSync(local)) return JSON.parse(fs.readFileSync(local, "utf8"));
  const cached = join(caseCacheDir(), name);
  if (fs.existsSync(cached)) {
    const data = fs.readFileSync(cached);
    if (sha256(data) === expected) return JSON.parse(data.toString("utf8"));
  }
  return null;
}

/** Make sure a large case set is available locally, downloading it once if needed. */
export async function ensureCaseSet(name, { fetchImpl = globalThis.fetch, localDir = LOCAL_DIR } = {}) {
  const expected = expectedHash(name);
  if (readCaseSetSync(name, { localDir })) return;
  const cached = join(caseCacheDir(), name);
  const url = `${RAW_BASE}/${name}`;
  if (process.env.HANDOFFKIT_OFFLINE === "1") {
    throw new CaseSetUnavailableError(
      `${name} is not bundled in the npm package and HANDOFFKIT_OFFLINE=1 blocks the download. `
        + `Fetch ${url} into ${cached} or use the 30-case set.`,
    );
  }
  let data;
  try {
    const response = await fetchImpl(url, {
      headers: { "user-agent": "handoffkit-benchmarks" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new CaseSetUnavailableError(
      `could not download ${name} from ${url}: ${error.message}. Retry with network access or use the 30-case set.`,
    );
  }
  const digest = sha256(data);
  if (digest !== expected) {
    throw new CaseSetUnavailableError(`${name} checksum mismatch (expected ${expected}, got ${digest}); refusing to use it`);
  }
  fs.mkdirSync(dirname(cached), { recursive: true });
  const tmp = `${cached}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, cached);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

/** File name of the case set that covers `limit` cases. */
export function caseSetForLimit(limit) {
  if (limit <= 30) return "doctor_cases_30.json";
  if (limit <= 100) return "doctor_cases_100.json";
  return "doctor_cases_400.json";
}
