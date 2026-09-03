import assert from "node:assert/strict";
import test from "node:test";
import { ClinicalError } from "@handoffkit/clinical";
import { applyAction, requireOfficialComplete, startRun, ClinicalLab } from "@handoffkit/clinical/engine";
import { createParityTranscript, loadRecordedTranscript } from "./clinical-events.ts";

test("clinical lab vague queries do not dump full_case", () => {
  const run = startRun({
    experience: "professional",
    track: "closed_sequential",
    opening: "Opening note.",
    blind_id: "pro-sandbox-001",
    sealed: { sections: { full_case: "NEVER DUMP THIS", history: "timeline" } },
    scoring_eligible: true,
  });
  applyAction(run, { name: "ask_question", query: "tell me everything" });
  assert.equal(run.observations[0].code, "evidence_not_available");
  assert.equal(String(run.observations[0].content).includes("NEVER DUMP THIS"), false);
});

test("parity transcript is heuristic_only and not three judges", () => {
  const wire = createParityTranscript();
  assert.equal(wire.phase, "closed");
  assert.equal(wire.score?.quorum, 0);
  assert.equal(wire.score?.heuristic_only, true);
  assert.equal(wire.score?.correct, false);
  assert.equal(wire.score?.clinical_validity, null);
  assert.equal(wire.observations[0].code, "evidence_not_available");
  assert.equal("final_diagnosis" in wire, false);
});

test("recorded fixture is distinct from a live sandbox transcript", () => {
  const recorded = loadRecordedTranscript();
  assert.equal(recorded.source, "recorded_fixture");
  assert.equal(recorded.replay, true);
  assert.equal(recorded.score?.scoring_mode, "gold_replay");
  const live = createParityTranscript();
  assert.equal(live.source, "live_sandbox");
  assert.equal(live.replay, false);
});

test("research experience does not create a professional run", () => {
  const lab = new ClinicalLab();
  assert.throws(
    () => lab.createRun({ experience: "research", blind_id: "pro-sandbox-001" }),
    (error) => error instanceof ClinicalError && error.code === "run_incomplete",
  );
});

test("official gate refuses partial reports", () => {
  assert.throws(
    () => requireOfficialComplete([{ status: "complete", score: { quorum: 3 } }]),
    (error) => error instanceof ClinicalError && error.code === "run_incomplete",
  );
});
