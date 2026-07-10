import assert from "node:assert/strict";
import test from "node:test";

import { Agent } from "@handoffkit/core";
import {
  Recipe,
  RecipeRunner,
  RecipeStep,
  WorkflowTemplate,
  planExecuteReviewRecipe,
  runModelFusionPanel,
  buildDubbingPlan,
  formatSRT,
  MediaAsset,
  TranscriptSegment,
  SpeakerProfile,
} from "../src/index.js";

test("recipe validates step shape and duplicate names", () => {
  const recipe = new Recipe({
    name: "demo",
    steps: [new RecipeStep({ name: "plan", task: "Plan." })],
  });

  assert.equal(recipe.validate(), recipe);
  assert.match(recipe.toMarkdown(), /Recipe: demo/);
  assert.throws(
    () => new Recipe({
      name: "bad",
      steps: [
        { name: "same", task: "A" },
        { name: "same", task: "B" },
      ],
    }).validate(),
    /step names must be unique/,
  );
});

test("recipe runner executes offline with structured handoffs", () => {
  const recipe = WorkflowTemplate.planExecuteReview({
    name: "release",
    task: "Ship JS CLI.",
    planner: new Agent({ name: "Planner" }),
    executor: new Agent({ name: "Executor" }),
    reviewer: new Agent({ name: "Reviewer" }),
  });
  const result = new RecipeRunner(recipe).run("Prepare release.");

  assert.equal(result.success, true);
  assert.equal(result.stepResults.length, 3);
  assert.equal(result.handoffStates.length, 2);
  assert.equal(result.handoffStates[0].fromAgent, "Planner");
  assert.match(result.toMarkdown(), /Recipe Run: release/);
});

test("built-in recipe is useful offline", () => {
  const result = new RecipeRunner(planExecuteReviewRecipe()).run();

  assert.equal(result.recipeName, "plan-execute-review");
  assert.match(result.finalOutput, /Echo/);
});

test("recipe runner executes async with arun", async () => {
  const recipe = WorkflowTemplate.planExecuteReview({
    name: "release-async",
    task: "Ship JS CLI async.",
    planner: new Agent({ name: "Planner" }),
    executor: new Agent({ name: "Executor" }),
    reviewer: new Agent({ name: "Reviewer" }),
  });
  const result = await new RecipeRunner(recipe).arun("Prepare release async.");

  assert.equal(result.success, true);
  assert.equal(result.stepResults.length, 3);
  assert.equal(result.handoffStates.length, 2);
  assert.equal(result.handoffStates[0].fromAgent, "Planner");
});

test("Model Fusion panel runs offline successfully", async () => {
  const report = await runModelFusionPanel({ real: false });
  
  assert.equal(report.success, true);
  assert.equal(report.panel.length, 4);
  assert.equal(report.mode, "offline-deterministic-panel");
  assert.match(report.toMarkdown(), /# Fusion-style Panel Demo/);
});

test("Media Localization builds dubbing plan and format SRT subtitles", () => {
  const source = new MediaAsset({ path: "market.mp4", mediaType: "video", language: "zh", durationSeconds: 5.0 });
  const segments = [
    new TranscriptSegment({ index: 1, start: 0.0, end: 2.0, text: "我们去商店吧", speaker: "SPK_1", language: "zh" }),
  ];
  const translations = { 1: "Vamos a la tienda." };
  const speakers = [
    new SpeakerProfile({ speakerId: "SPK_1", label: "Operations manager", voice: "es-calm", language: "es" }),
  ];
  
  const dubbingPlan = buildDubbingPlan(segments, translations, speakers);
  assert.equal(dubbingPlan.length, 1);
  assert.equal(dubbingPlan[0].targetText, "Vamos a la tienda.");
  assert.equal(dubbingPlan[0].voice, "es-calm");
  
  const srtContent = formatSRT(dubbingPlan, { translated: true });
  assert.match(srtContent, /00:00:00,000 --> 00:00:02,000/);
  assert.match(srtContent, /Vamos a la tienda\./);
  assert.ok(source.path);
});

test("Media 1.13 context handoffs match Python -ion surface", async () => {
  const {
    MEDIA_OPERATIONS,
    mediaOperationCatalog,
    getMediaOperation,
    listMediaPipelines,
    buildCreationContext,
    buildGenerationContext,
    handoffMediaContext,
    planMediaPipeline,
    applyTranscriptEditions,
    MediaEditionOp,
    MediaContext,
    mediaContextToWorkflowReport,
  } = await import("../src/index.js");

  const catalog = mediaOperationCatalog();
  assert.equal(catalog.length, MEDIA_OPERATIONS.length);
  for (const name of MEDIA_OPERATIONS) {
    assert.ok(name.endsWith("ion"));
    assert.equal(getMediaOperation(name).name, name);
  }
  assert.ok(listMediaPipelines().from_scratch);
  assert.ok(listMediaPipelines().video_dubbing);

  let ctx = buildCreationContext("Make a 20s clip", { targetLanguage: "es" });
  assert.equal(ctx.operation, "creation");
  assert.ok(ctx.nextOperations.includes("generation"));

  ctx = handoffMediaContext(ctx, "generation", { fromAgent: "creator", toAgent: "generator" });
  assert.equal(ctx.operation, "generation");
  assert.deepEqual(ctx.history, ["creation"]);
  assert.equal(ctx.metadata.last_handoff.from_agent, "creator");

  const gen = buildGenerationContext("Narrate calmly", { prompts: ["line 1"], mediaType: "audio" });
  assert.equal(gen.operation, "generation");
  assert.deepEqual(gen.generationPrompts, ["line 1"]);

  ctx = handoffMediaContext(ctx, "edition");
  assert.equal(ctx.operation, "edition");
  assert.deepEqual(ctx.history, ["creation", "generation"]);

  const segs = [
    new TranscriptSegment({ index: 1, start: 0, end: 1, text: "Hello", speaker: "A" }),
    new TranscriptSegment({ index: 2, start: 1, end: 2, text: "World", speaker: "A" }),
  ];
  ctx.transcriptSegments = applyTranscriptEditions(segs, { 2: "World!" });
  ctx.editionOps = [new MediaEditionOp({ opType: "rewrite", target: "2", payload: { text: "World!" } })];
  assert.equal(ctx.transcriptSegments[1].text, "World!");

  const handoff = ctx.toHandoffState({ fromAgent: "editor", toAgent: "validator" });
  assert.equal(handoff.metadata.kind, "media_context");
  const restored = MediaContext.fromHandoffState(handoff);
  assert.equal(restored.operation, "edition");
  assert.deepEqual(restored.history, ["creation", "generation"]);

  const report = mediaContextToWorkflowReport(restored);
  assert.equal(report.metadata.operation, "edition");
  assert.equal(MediaContext.fromJSON(restored.toJSON()).brief, restored.brief);

  const planned = planMediaPipeline("video_dubbing", {
    brief: "Dub demo",
    targetLanguage: "es",
    source: new MediaAsset({ path: "clip.mp4", mediaType: "video" }),
  });
  assert.deepEqual(
    planned.map((c) => c.operation),
    listMediaPipelines().video_dubbing
  );
  assert.equal(planned[0].nextOperations[0], "transcription");
  assert.deepEqual(planned[2].history, ["inspection", "transcription"]);
});
