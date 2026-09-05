import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIONS,
  ClinicalAction,
  ClinicalClient,
  ClinicalError,
  ClinicalRun,
  CONTRACT_VERSION,
  ERROR_CODES,
  HANDOFFKIT_CLINICAL_VERSION,
  OFFICIAL_CASE_COUNT,
  PUBLIC_CASES,
} from "../src/index.js";
import {
  ClinicalLab,
  applyAction,
  assertRetrievalUrl,
  executeRole,
  requireOfficialComplete,
  scoreRun,
  startRun,
} from "../src/engine.js";
import { looksPersonal } from "../src/privacy.js";
import { GOLD_FIELDS } from "../src/constants.js";

test("runtime version matches v1beta contract", () => {
  assert.equal(HANDOFFKIT_CLINICAL_VERSION, "1.20.0-alpha.2");
  assert.equal(CONTRACT_VERSION, HANDOFFKIT_CLINICAL_VERSION);
  assert.equal(OFFICIAL_CASE_COUNT, 897);
  assert.ok(ACTIONS.includes("ask_question"));
  assert.ok(ERROR_CODES.includes("gold_leak_detected"));
});

test("vague queries never dump the full case", () => {
  const run = startRun({
    experience: "professional",
    track: "closed_sequential",
    blind_id: "pro-sandbox-001",
    opening: "Opening note only.",
    scoring_eligible: true,
    sealed: {
      final_diagnosis: "Influenza-like illness",
      sections: { history: "secret history", full_case: "NEVER DUMP THIS" },
    },
  });
  applyAction(run, { name: "ask_question", query: "tell me everything" });
  assert.equal(run.observations[0].code, "evidence_not_available");
  assert.equal(run.observations[0].content.includes("NEVER DUMP THIS"), false);
});

test("idempotent retries do not double-spend", () => {
  const run = startRun({
    experience: "professional",
    track: "closed_sequential",
    blind_id: "pro-sandbox-001",
    opening: "Opening note only.",
    scoring_eligible: true,
    sealed: { sections: { history: "Four day winter cough timeline." } },
  });
  applyAction(run, { action_id: "a1", name: "ask_question", query: "history of present illness" });
  applyAction(run, { action_id: "a1", name: "ask_question", query: "history of present illness" });
  assert.equal(run.rounds, 1);
  assert.equal(run.observations.length, 1);
});

test("diagnosis can be submitted only once", () => {
  const run = startRun({
    experience: "professional",
    track: "closed_sequential",
    blind_id: "pro-sandbox-001",
    opening: "Opening note only.",
    scoring_eligible: true,
    sealed: { final_diagnosis: "Influenza-like illness", aliases: ["ILI"] },
  });
  applyAction(run, { name: "submit_diagnosis", query: "Influenza-like illness" });
  assert.equal(run.phase, "closed");
  assert.equal(run.score.complete, true);
  assert.equal(run.score.correct, false);
  assert.equal(run.score.heuristic_only, true);
  assert.equal(run.score.quorum, 0);
  assert.equal(run.score.toWire().clinical_validity, null);
  assert.throws(
    () => applyAction(run, { name: "submit_diagnosis", query: "again" }),
    (error) => error instanceof ClinicalError && error.code === "invalid_transition",
  );
});

test("gold leak is detected before close", () => {
  const run = startRun({
    experience: "professional",
    track: "closed_sequential",
    blind_id: "x",
    opening: "Opening.",
    sealed: { final_diagnosis: "SecretGoldDxLabel", pmcid: "PMC9999999" },
  });
  assert.throws(
    () => applyAction(run, { name: "ask_question", query: "is it SecretGoldDxLabel" }),
    (error) => error instanceof ClinicalError && error.code === "gold_leak_detected",
  );
});

test("retrieval blocks localhost and source article", () => {
  const run = startRun({
    experience: "professional",
    track: "retrieval_assisted",
    blind_id: "x",
    opening: "Opening.",
    sealed: { pmcid: "PMC1234567", article_link: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1234567/" },
  });
  assert.throws(() => assertRetrievalUrl("http://127.0.0.1/secret", run), /retrieval/);
  assert.throws(
    () => assertRetrievalUrl("https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1234567/", run),
    /retrieval/,
  );
});

test("official complete gate requires 897 scored results", () => {
  assert.throws(() => requireOfficialComplete([{ status: "complete", score: { quorum: 3 } }]), (error) => {
    return error instanceof ClinicalError && error.code === "run_incomplete";
  });
});

test("public cases are simulated and not personally entered", () => {
  assert.equal(PUBLIC_CASES.length, 3);
  assert.ok(PUBLIC_CASES.every((item) => item.blind_id.startsWith("sim-public-")));
});

test("wire models round-trip snake_case", () => {
  const action = new ClinicalAction({ name: "ask_question", query: "history", action_id: "a" });
  assert.equal(action.toWire().action_id, "a");
  const run = new ClinicalRun({
    experience: "public",
    track: "closed_sequential",
    phase: "deliberate",
    run_id: "run-1",
  });
  const wire = run.toWire();
  assert.equal(wire.scoring_eligible, false);
  assert.equal(wire.contract_version, CONTRACT_VERSION);
});

test("client posts snake_case bodies", async () => {
  const calls = [];
  const client = new ClinicalClient({
    baseUrl: "/api/clinical/v1beta",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({
          run_id: "run-1",
          experience: "professional",
          track: "closed_sequential",
          phase: "deliberate",
        }),
      };
    },
  });
  await client.createRun({ experience: "professional", blind_id: "pro-sandbox-001" });
  assert.equal(calls[0].url, "/api/clinical/v1beta/runs");
  assert.equal(JSON.parse(calls[0].init.body).blind_id, "pro-sandbox-001");
});

function proRun(overrides = {}) {
  return startRun({
    experience: "professional",
    track: "closed_sequential",
    blind_id: "pro-sandbox-001",
    opening: "Opening note only.",
    scoring_eligible: true,
    sealed: {
      final_diagnosis: "Influenza-like illness",
      aliases: ["ILI"],
      title: "sandbox-winter-respiratory",
      pmcid: "PMC9999999",
      article_link: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9999999/",
      diagnostic_reasoning: "secret reasoning vault",
      sections: {
        history: "Post-flight winter onset over four days with fever then lingering dry cough and a long evidence card.",
      },
    },
    ...overrides,
  });
}

test("false diagnosis with evidence is not correct", () => {
  const run = proRun();
  applyAction(run, { name: "ask_question", query: "history of present illness" });
  applyAction(run, { name: "submit_diagnosis", query: "Completely fabricated zeolite poisoning" });
  assert.equal(run.score.correct, false);
  assert.equal(run.score.heuristic_only, true);
  assert.equal(run.score.exact_match, false);
  assert.equal(run.score.toWire().clinical_validity, null);
});

test("alias match is regression-only and empty diagnosis is incorrect", () => {
  const alias = proRun();
  applyAction(alias, { name: "submit_diagnosis", query: "ILI" });
  assert.equal(alias.score.alias_match, true);
  assert.equal(alias.score.correct, false);
  const empty = proRun();
  applyAction(empty, { name: "submit_diagnosis", query: "" });
  assert.equal(empty.score.correct, false);
  assert.equal(empty.score.exact_match, false);
});

test("missing and failing judges fail closed", () => {
  const run = proRun();
  run.diagnosis = "Influenza-like illness";
  const missing = scoreRun(run, []);
  assert.equal(missing.complete, false);
  assert.equal(missing.correct, false);
  const failing = scoreRun(run, [() => { throw new Error("boom"); }, () => 5, () => 5]);
  assert.equal(failing.complete, false);
  assert.equal(failing.correct, false);
});

test("research and retrieval do not silently start", () => {
  const lab = new ClinicalLab();
  assert.throws(
    () => lab.createRun({ experience: "research", blind_id: "pro-sandbox-001" }),
    (error) => error instanceof ClinicalError && error.code === "run_incomplete",
  );
  assert.throws(
    () => lab.createRun({ experience: "professional", blind_id: "pro-sandbox-001", track: "retrieval_assisted" }),
    (error) => error instanceof ClinicalError && error.code === "retrieval_blocked",
  );
});

test("personal input is rejected on create and action", () => {
  const lab = new ClinicalLab();
  assert.throws(
    () => lab.createRun({ experience: "professional", blind_id: "pro-sandbox-001", symptoms: "I have chest pain" }),
    (error) => error instanceof ClinicalError && error.code === "personal_input_rejected" && !error.message.includes("chest"),
  );
  const run = lab.createRun({ experience: "professional", blind_id: "pro-sandbox-001" });
  for (const query of ["My name is Jane Doe", "Call me at 555-123-4567", "email patient@example.com", "I live at 123 Main Street", "SSN 123-45-6789", "I have chest pain and fever"]) {
    assert.throws(
      () => lab.act(run.run_id, { name: "ask_question", query }),
      (error) => error instanceof ClinicalError && error.code === "personal_input_rejected" && !String(error.message).includes("Jane"),
    );
  }
  assert.equal(run.rounds, 0);
  assert.equal(looksPersonal("history of present illness"), false);
});

test("gold stays out of the participant wire", () => {
  const run = proRun();
  const wire = run.toWire();
  const blob = JSON.stringify(wire);
  for (const field of GOLD_FIELDS) assert.equal(field in wire, false);
  assert.equal(blob.includes("secret reasoning vault"), false);
  assert.equal(blob.includes("PMC9999999"), false);
  assert.throws(
    () => applyAction(proRun(), { name: "ask_question", query: "please confirm ILI now" }),
    (error) => error instanceof ClinicalError && error.code === "gold_leak_detected",
  );
});

test("idempotency conflict and stale revision fail", () => {
  const run = proRun();
  applyAction(run, { action_id: "a1", name: "ask_question", query: "history of present illness" });
  assert.throws(
    () => applyAction(run, { action_id: "a1", name: "ask_question", query: "physical exam findings" }),
    (error) => error instanceof ClinicalError && error.code === "idempotency_conflict",
  );
  assert.throws(
    () => applyAction(run, { name: "ask_question", query: "history of present illness", expected_revision: 0 }),
    (error) => error instanceof ClinicalError && error.code === "revision_conflict",
  );
});

test("concurrent-style lab actions keep both keys", async () => {
  const lab = new ClinicalLab();
  const run = lab.createRun({ experience: "professional", blind_id: "pro-sandbox-001" });
  await Promise.all([
    Promise.resolve().then(() => lab.act(run.run_id, { name: "ask_question", query: "history of present illness", action_id: "c1", idempotency_key: "c1" })),
    Promise.resolve().then(() => lab.act(run.run_id, { name: "ask_question", query: "history of present illness", action_id: "c2", idempotency_key: "c2" })),
  ]);
  assert.equal(run.rounds, 2);
});

test("recorded fixture is marked recorded and not generated", () => {
  const lab = new ClinicalLab();
  const replay = lab.createRun({ replay: true, fixture_id: "clinical-recorded-run-v1" });
  assert.equal(replay.source, "recorded_fixture");
  assert.equal(replay.score.scoring_mode, "gold_replay");
  assert.equal(replay.score.correct, false);
});

test("roles remain unavailable scaffolds", () => {
  assert.throws(
    () => executeRole("hypothesis", "propose"),
    (error) => error instanceof ClinicalError && error.code === "provider_unavailable",
  );
});
