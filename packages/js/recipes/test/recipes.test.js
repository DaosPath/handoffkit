import assert from "node:assert/strict";
import test from "node:test";

import { Agent } from "@handoffkit/core";
import {
  Recipe,
  RecipeRunner,
  RecipeStep,
  WorkflowTemplate,
  planExecuteReviewRecipe,
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
