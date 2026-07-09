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
});
