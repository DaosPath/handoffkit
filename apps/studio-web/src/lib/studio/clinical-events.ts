import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PROFESSIONAL_CASES, PUBLIC_CASES } from "@handoffkit/clinical";
import { applyAction, loadRecordedFixture, startRun } from "@handoffkit/clinical/engine";

export function createParityTranscript() {
  const found = PROFESSIONAL_CASES[0];
  const run = startRun({
    experience: "professional",
    track: "closed_sequential",
    opening: String(found.opening),
    blind_id: String(found.blind_id),
    sealed: found.sealed || {},
    scoring_eligible: true,
    source: "live_sandbox",
  });
  applyAction(run, { name: "ask_question", query: "tell me everything" });
  applyAction(run, { name: "ask_question", query: "history of present illness" });
  applyAction(run, { name: "submit_diagnosis", query: "Influenza-like illness" });
  return run.toWire();
}

export function loadRecordedTranscript() {
  return loadRecordedFixture().toWire();
}

export async function writeClinicalArtifact(root: string, run: ReturnType<typeof createParityTranscript>) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
}

export { PUBLIC_CASES, PROFESSIONAL_CASES };
