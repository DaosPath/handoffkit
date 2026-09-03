import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  OFFICIAL_CASE_COUNT,
  PROFESSIONAL_CASES,
  PUBLIC_CASES,
  STATUS_PUBLIC,
  ClinicalError,
  ClinicalRun,
} from "@handoffkit/clinical";
import {
  DEFAULT_VAULT,
  RETRIEVAL_TRACK_STATUS,
  applyAction,
  loadRecordedFixture,
  rejectActPayload,
  rejectCreatePayload,
  startRun,
} from "@handoffkit/clinical/engine";

const ROOT = join(process.cwd(), ".data", "clinical-runs");
const STORE_FORMAT = "handoffkit.clinical.store.v1";

function ensureRoot() {
  mkdirSync(ROOT, { recursive: true });
}

function safeRunId(runId: string) {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(runId) || runId.includes("..")) {
    throw new ClinicalError("invalid run id", { code: "invalid_request" });
  }
  return runId;
}

function pathFor(runId: string) {
  return join(ROOT, `${safeRunId(runId)}.json`);
}

function checksum(body: unknown) {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export function clinicalManifests() {
  return {
    status_public: STATUS_PUBLIC,
    manifests: [
      {
        id: "public-simulated",
        experience: "public",
        count: PUBLIC_CASES.length,
        scoring_eligible: false,
        personal_input: false,
        status: "experimental",
      },
      {
        id: "professional-sandbox",
        experience: "professional",
        count: PROFESSIONAL_CASES.length,
        scoring_eligible: true,
        deidentified: true,
        status: "experimental",
      },
      {
        id: "medcase-reasoning-test",
        experience: "research",
        count: OFFICIAL_CASE_COUNT,
        scoring_eligible: true,
        available: false,
        status: "unavailable",
        note: "Official 897-case corpus is unavailable. No live 897/897 score is claimed.",
      },
    ],
  };
}

function findCase(blindId: string) {
  return (
    PUBLIC_CASES.find((item) => item.blind_id === blindId) ||
    PROFESSIONAL_CASES.find((item) => item.blind_id === blindId) ||
    null
  );
}

export function saveClinicalRun(run: ClinicalRun) {
  ensureRoot();
  const body = {
    run: run.toWire({ includeSealed: true }),
    vault: DEFAULT_VAULT.get(run.run_id),
  };
  const envelope = { format: STORE_FORMAT, format_version: 1, checksum: checksum(body), body };
  const target = pathFor(run.run_id);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(envelope, null, 2)}\n`);
  renameSync(tmp, target);
}

export function loadClinicalRun(runId: string) {
  try {
    const raw = JSON.parse(readFileSync(pathFor(runId), "utf8"));
    const body = raw.format === STORE_FORMAT ? raw.body : { run: raw, vault: {} };
    if (raw.format === STORE_FORMAT && checksum(body) !== raw.checksum) {
      throw new ClinicalError("stored run is corrupt", { code: "store_corrupt" });
    }
    const run = new ClinicalRun(body.run || raw);
    if (body.vault) DEFAULT_VAULT.seal(run.run_id, body.vault);
    return run;
  } catch (error) {
    if (error instanceof ClinicalError) throw error;
    throw new ClinicalError("run not found", { code: "invalid_request" });
  }
}

export function createClinicalRun(body: Record<string, unknown>) {
  rejectCreatePayload(body);
  if (body.replay) {
    const run = loadRecordedFixture(String(body.fixture_id || "clinical-recorded-run-v1"));
    saveClinicalRun(run);
    return run;
  }
  const experience = String(body.experience || "professional");
  const track = String(body.track || "closed_sequential");
  if (experience === "research") {
    throw new ClinicalError("official 897-case corpus is unavailable", {
      code: "run_incomplete",
      details: { experience: "research", status: "unavailable" },
    });
  }
  if (track === "retrieval_assisted") {
    throw new ClinicalError("retrieval-assisted track is unavailable until Browser Real is connected", {
      code: "retrieval_blocked",
      details: { track_status: RETRIEVAL_TRACK_STATUS },
    });
  }
  const blindId = String(body.blind_id || "");
  const found = findCase(blindId);
  if (experience === "public" && (!found || found.experience !== "public")) {
    throw new ClinicalError("public explorer only accepts selectable simulated cases", {
      code: "personal_input_rejected",
    });
  }
  if (!found) throw new ClinicalError("unknown case", { code: "invalid_request" });
  const run = startRun({
    experience,
    track,
    opening: String(found.opening || ""),
    blind_id: blindId,
    sealed: found.sealed || {},
    locale: String(body.locale || "en"),
    replay: false,
    scoring_eligible: experience === "professional",
    differential: found.differential || [],
    source: "live_sandbox",
  });
  saveClinicalRun(run);
  return run;
}

export function actClinicalRun(runId: string, body: Record<string, unknown>) {
  rejectActPayload(body);
  const run = loadClinicalRun(runId);
  if (run.track === "retrieval_assisted") {
    throw new ClinicalError("retrieval-assisted track is unavailable until Browser Real is connected", {
      code: "retrieval_blocked",
      details: { track_status: RETRIEVAL_TRACK_STATUS },
    });
  }
  const expected = run.revision;
  const updated = applyAction(run, body);
  if (updated.revision !== expected + 1 && updated.revision !== expected) {
    throw new ClinicalError("run revision conflict", { code: "revision_conflict" });
  }
  saveClinicalRun(updated);
  return updated;
}

export function startClinicalBenchmark(body: Record<string, unknown>) {
  if (body.official) {
    throw new ClinicalError(
      "official 897/897 run is unavailable until the pinned corpus is built",
      { code: "run_incomplete", details: { expected: OFFICIAL_CASE_COUNT, status: "unavailable" } },
    );
  }
  return {
    id: "bench-sandbox",
    official: false,
    status: "incomplete",
    status_public: STATUS_PUBLIC,
    results: [],
  };
}

export function clinicalErrorStatus(error: unknown) {
  if (error instanceof ClinicalError) {
    const status =
      error.code === "invalid_request"
      || error.code === "personal_input_rejected"
      ? 400
      : error.code === "revision_conflict" || error.code === "idempotency_conflict"
        ? 409
        : 409;
    return { status, body: error.toWire() };
  }
  return {
    status: 500,
    body: { code: "invalid_request", message: "unexpected clinical error", details: {} },
  };
}

export { PUBLIC_CASES, PROFESSIONAL_CASES, STATUS_PUBLIC, OFFICIAL_CASE_COUNT, RETRIEVAL_TRACK_STATUS };
