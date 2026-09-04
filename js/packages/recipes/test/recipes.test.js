import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { CspRuntime } from "../../csp/src/index.js";

import { Agent } from "@handoffkit/core";
import { createDefaultBrowserBridge, makeFixtureMapTransport } from "@handoffkit/browser";
import {
  Recipe,
  RecipeRunner,
  RecipeStep,
  WorkflowTemplate,
  planExecuteReviewRecipe,
  runModelFusionPanel,
  realFusionPanel,
  ffmpegAvailable,
  buildDubbingPlan,
  formatSRT,
  MediaAsset,
  TranscriptSegment,
  SpeakerProfile,
  runWebGroundedAnswer,
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

test("recipe runner session mode preserves CSP handoffs", async () => {
  const recipe = WorkflowTemplate.planExecuteReview({
    name: "release-session",
    task: "Ship CSP support.",
    planner: new Agent({ name: "Planner" }),
    executor: new Agent({ name: "Executor" }),
    reviewer: new Agent({ name: "Reviewer" }),
  });
  const result = await new RecipeRunner(recipe, {
    runtimeMode: "session",
    runtime: new CspRuntime(),
  }).arun("Prepare release session.");

  assert.equal(result.success, true);
  assert.equal(result.handoffStates.length, 2);
  assert.equal(result.metadata.runtime_mode, "session");
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
  assert.ok(listMediaPipelines().screen_dubbing);
  assert.equal(listMediaPipelines().screen_dubbing[2], "edition");

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

test("screen dubbing merges OCR+ASR and runs the agent recipe", async () => {
  const {
    mergeOcrAsrSegments,
    buildScreenNarrationPrompt,
    parseScreenNarrationJson,
    screenDubbingAgentRecipe,
    RecipeRunner,
  } = await import("../src/index.js");

  const ocr = [
    new TranscriptSegment({ index: 1, start: 0, end: 2, text: "他们为了出气", speaker: "NARR", language: "zh" }),
    new TranscriptSegment({ index: 2, start: 4, end: 6, text: "招娣回来了", speaker: "NARR", language: "zh" }),
  ];
  const asr = [
    new TranscriptSegment({ index: 1, start: 0.1, end: 1.8, text: "为了出气", speaker: "S1", language: "zh" }),
    new TranscriptSegment({ index: 2, start: 2.2, end: 3.5, text: "我头好痛", speaker: "S1", language: "zh" }),
    new TranscriptSegment({ index: 3, start: 4, end: 6, text: "赵弟回来了", speaker: "S2", language: "zh" }),
  ];
  const merged = mergeOcrAsrSegments(ocr, asr, { language: "zh" });
  assert.match(merged[0].text, /他们为了出气/);
  assert.ok(merged.some((item) => item.text.includes("我头好痛")));
  assert.equal(merged[0].metadata.text_ocr, "他们为了出气");

  const prompt = buildScreenNarrationPrompt(ocr, asr, {
    targetLanguage: "es",
    title: "0001 pigsty",
    glossary: { 招娣: "Zhaodi" },
  });
  assert.match(prompt.user, /CONSENSUS/);
  assert.match(prompt.user, /招娣 → Zhaodi/);
  assert.match(prompt.system, /producer agent/);

  const parsed = parseScreenNarrationJson(
    '```json\n[{"index":1,"start":0,"end":2,"text_zh":"他们为了出气","text_es":"Lo hicieron para desahogarse."}]\n```',
  );
  assert.equal(parsed[0].text_es, "Lo hicieron para desahogarse.");

  const { buildSpokenFitPrompt, parseSpokenFitJson } = await import("../src/index.js");
  const fitPrompt = buildSpokenFitPrompt(
    [{ index: 1, start: 0, end: 2, text_zh: "他们为了出气", text_es: "Lo hicieron para desahogarse de una manera demasiado larga." }],
    { title: "0001", maxSpeed: 1.35 },
  );
  assert.match(fitPrompt.user, /budget≈/);
  assert.match(fitPrompt.system, /localizer agent/);
  const fitted = parseSpokenFitJson(
    '[{"index":1,"start":0,"end":2,"text_es":"Lo hicieron para desahogarse.","rate":"+8%"}]',
  );
  assert.equal(fitted[0].rate, "+8%");
  assert.equal(fitted[0].text_es, "Lo hicieron para desahogarse.");

  const recipe = screenDubbingAgentRecipe({ targetLanguage: "es" });
  assert.equal(recipe.name, "screen-dubbing");
  assert.deepEqual(
    recipe.steps.map((step) => step.name),
    ["inspect", "transcribe", "consensus", "translate", "localize", "generate", "compose", "validate", "publish"],
  );
  const result = new RecipeRunner(recipe).run("Dub the pigsty scene.");
  assert.equal(result.success, true);
  assert.equal(result.recipeName, "screen-dubbing");
});


test("real fusion uses the public providers API concurrently", async () => {
  const calls = [];
  const panel = await realFusionPanel("ollama", ["model-a", "model-b"], "Review this", {
    timeout: 1,
    maxParallel: 2,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body.model);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ choices: [{ message: { content: `answer-${body.model}` } }] });
        },
      };
    },
  });
  assert.deepEqual(calls.sort(), ["model-a", "model-b"]);
  assert.equal(panel.length, 2);
  assert.equal(panel.every((item) => item.confidence === "model-reported"), true);
});

test("ffmpeg detection never invokes a shell", async () => {
  assert.equal(await ffmpegAvailable("definitely-not-an-executable;echo-pwned"), false);
});

test("media constructors tolerate missing wire objects", () => {
  assert.equal(MediaAsset.fromDict().path, "");
  assert.equal(TranscriptSegment.fromDict().text, "");
  assert.equal(SpeakerProfile.fromDict().speakerId, "");
  assert.equal(buildDubbingPlan([new TranscriptSegment({ index: 1, text: "source" })])[0].targetText, "source");
});

test("runWebGroundedAnswer enforces search → select → markdown → answer", async () => {
  const transport = makeFixtureMapTransport();
  transport.setPage(
    "https://html.duckduckgo.com/html/?q=Fixture",
    '<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Ffixture.local%2Fabout.html">About Fixture</a>',
  );
  const calls = [];
  const provider = {
    model: "fixture",
    async agenerate(prompt) {
      calls.push(prompt);
      if (prompt.includes("evidence_pages")) {
        return JSON.stringify({ answer: "Fixture answer", evidence_pages: "all" });
      }
      return JSON.stringify({ selected_urls: ["https://fixture.local/about.html"] });
    },
  };
  const result = await runWebGroundedAnswer({
    query: "Fixture",
    providers: ["duckduckgo"],
    transport,
    provider,
    maxPages: 1,
  });
  assert.equal(result.success, true);
  assert.equal(result.answer, "Fixture answer");
  assert.equal(result.selection.valid, true);
  assert.deepEqual(result.selection.selected_urls, ["https://fixture.local/about.html"]);
  assert.equal(result.answer_audit.coverage, true);
  assert.equal(result.research.metadata.answer_flow, "live_search_markdown_select_explore_markdown_answer");
  assert.equal(calls.length, 2);
});

test("runWebGroundedAnswer accepts explicit all-page grounding without title catalogue", async () => {
  const transport = makeFixtureMapTransport();
  transport.setPage(
    "https://html.duckduckgo.com/html/?q=Concise",
    '<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Ffixture.local%2Fevidence.html">Long Evidence Title</a>',
  );
  transport.setPage(
    "https://fixture.local/evidence.html",
    "<html><head><title>Long Evidence Title</title></head><body><main><p>Grounded evidence.</p></main></body></html>",
  );
  const provider = {
    model: "fixture",
    async agenerate(prompt) {
      if (prompt.includes("evidence_pages")) {
        return JSON.stringify({ answer: "Concise grounded synthesis.", evidence_pages: "all" });
      }
      return JSON.stringify({ selected_urls: ["https://fixture.local/evidence.html"] });
    },
  };
  const result = await runWebGroundedAnswer({
    query: "Concise",
    providers: ["duckduckgo"],
    transport,
    provider,
    maxPages: 1,
  });
  assert.equal(result.success, true);
  assert.equal(result.answer_audit.coverage, true);
});

test("runWebGroundedAnswer builds a structured dossier and falls back deterministically", async () => {
  const transport = makeFixtureMapTransport();
  transport.setPage(
    "https://html.duckduckgo.com/html/?q=Dossier",
    '<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Ffixture.local%2Fdossier.html">Dossier Evidence</a>',
  );
  transport.setPage(
    "https://fixture.local/dossier.html",
    "<html><head><title>Dossier Evidence</title></head><body><main><p>The verified mechanism uses two explicit stages.</p></main></body></html>",
  );
  const provider = {
    model: "fixture",
    async agenerate(prompt) {
      if (prompt.includes("Extract evidence for exactly ONE requirement")) {
        return JSON.stringify({
          section_id: "method",
          findings: [{ status: "supported", statement: "The verified mechanism uses two explicit stages.", quote: "The verified mechanism uses two explicit stages.", evidence_pages: [1] }],
        });
      }
      if (prompt.includes("Selecciona las páginas")) {
        return JSON.stringify({ selected_urls: ["https://fixture.local/dossier.html"] });
      }
      return "malformed final answer";
    },
  };
  const result = await runWebGroundedAnswer({
    query: "Dossier",
    providers: ["duckduckgo"],
    transport,
    provider,
    maxPages: 1,
    answerRetries: 0,
    evidenceSections: [{
      id: "method",
      title: "Method",
      render: "paragraph",
      requirements: ["Explain the two stages.", "Confirm the verified mechanism."],
      deterministicEvidence: [{
        requirement: "Confirm the verified mechanism.",
        statement: "The verified mechanism uses two explicit stages.",
        quote: "verified mechanism uses two explicit stages",
      }],
    }],
    synthesisSections: [{
      id: "summary",
      title: "Summary",
      render: "table",
      columns: ["Claim", "Result"],
      requirements: ["Combine the two verified claims."],
      deterministicFindings: [{
        requirement: "Combine the two verified claims.",
        statement: "Both checks support the verified two-stage mechanism.",
        cells: ["Combined", "Both checks support the verified two-stage mechanism."],
        evidenceClaims: ["method:0", "method:1"],
      }],
    }],
    dossierComposeMode: "deterministic",
  });
  assert.equal(result.success, true);
  assert.equal(result.evidence_dossier.valid, true);
  assert.equal(result.evidence_dossier.sections[0].findings[0].verification.quote_matched, true);
  assert.match(result.answer, /two explicit stages/);
  assert.match(result.answer, /Both checks support/);
  assert.match(result.answer, /\| Claim \| Result \|/);
  assert.match(result.answer, /Direct evidence:/);
  assert.equal(result.answer_audit.evidence_dossier_valid, true);
});

test("runWebGroundedAnswer rejects a real quote unrelated to its requirement", async () => {
  const transport = makeFixtureMapTransport();
  transport.setPage(
    "https://html.duckduckgo.com/html/?q=Adoption",
    '<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Ffixture.local%2Fadoption.html">Evidence</a>',
  );
  transport.setPage(
    "https://fixture.local/adoption.html",
    "<html><body><main>The estimator aggregates cohort-specific effects, but this page has no journal counts.</main></body></html>",
  );
  const provider = {
    async agenerate(prompt) {
      if (prompt.includes("Extract evidence for exactly ONE requirement")) {
        return JSON.stringify({
          section_id: "adoption",
          findings: [{
            status: "supported",
            statement: "The estimator aggregates cohort-specific effects.",
            quote: "estimator aggregates cohort-specific effects",
            evidence_pages: [1],
          }],
        });
      }
      return JSON.stringify({ selected_urls: ["https://fixture.local/adoption.html"] });
    },
  };
  const result = await runWebGroundedAnswer({
    query: "Adoption",
    providers: ["duckduckgo"],
    transport,
    provider,
    maxPages: 1,
    evidenceSections: [{
      id: "adoption",
      requirements: ["Report bibliometric adoption rates for AER, QJE, and JPE during 2020-2024."],
    }],
    dossierComposeMode: "deterministic",
  });
  assert.equal(result.evidence_dossier.sections[0].findings[0].status, "not_found");
  assert.match(result.answer, /Evidence not found/);
});

test("runWebGroundedAnswer merges focused native-browser queries", async () => {
  const transport = makeFixtureMapTransport();
  transport.setPage(
    "https://www.google.com/search?hl=en&num=8&q=Fixture",
    '<a href="/url?q=https%3A%2F%2Ffixture.local%2Fabout.html&amp;sa=U">About Fixture</a>',
  );
  transport.setPage(
    "https://www.google.com/search?hl=en&num=8&q=fixture+guide",
    '<a href="/url?q=https%3A%2F%2Ffixture.local%2Fdocs%2Fguide.html&amp;sa=U">Fixture Guide</a>',
  );
  const provider = {
    model: "fixture",
    async agenerate(prompt) {
      if (prompt.includes("evidence_pages")) {
        return JSON.stringify({ answer: "Fixture Guide and About Fixture", evidence_pages: "all" });
      }
      return JSON.stringify({
        selected_urls: [
          "https://fixture.local/about.html",
          "https://fixture.local/docs/guide.html",
        ],
      });
    },
  };
  const result = await runWebGroundedAnswer({
    query: "Fixture research",
    searchQueries: ["Fixture", "fixture guide"],
    providers: ["google"],
    transport,
    provider,
    maxPages: 2,
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.research.metadata.search_queries, ["Fixture", "fixture guide"]);
  assert.equal(result.research.pages_ok, 2);
});

test("runWebGroundedAnswer preserves one fetched candidate per focused query", async () => {
  const transport = makeFixtureMapTransport();
  transport.setPage(
    "https://www.google.com/search?hl=en&num=8&q=alpha",
    '<a href="/url?q=https%3A%2F%2Ffixture.local%2Falpha.html&amp;sa=U">Alpha evidence</a>',
  );
  transport.setPage(
    "https://www.google.com/search?hl=en&num=8&q=beta",
    '<a href="/url?q=https%3A%2F%2Ffixture.local%2Fbeta.html&amp;sa=U">Beta evidence</a>',
  );
  transport.setPage(
    "https://fixture.local/alpha.html",
    "<html><head><title>Alpha evidence</title></head><body><main><h1>Alpha evidence</h1><p>Alpha proof.</p></main></body></html>",
  );
  transport.setPage(
    "https://fixture.local/beta.html",
    "<html><head><title>Beta evidence</title></head><body><main><h1>Beta evidence</h1><p>Beta proof.</p></main></body></html>",
  );
  const provider = {
    model: "fixture",
    async agenerate(prompt) {
      if (prompt.includes("evidence_pages")) {
        return JSON.stringify({ answer: "Alpha evidence and Beta evidence", evidence_pages: "all" });
      }
      // Deliberately select only alpha. Coverage policy must add beta.
      return JSON.stringify({ selected_urls: ["https://fixture.local/alpha.html"] });
    },
  };
  const result = await runWebGroundedAnswer({
    query: "alpha beta",
    searchQueries: ["alpha", "beta"],
    maxSubQueries: 2,
    providers: ["google"],
    transport,
    provider,
    maxPages: 2,
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.selection.selected_urls, [
    "https://fixture.local/alpha.html",
    "https://fixture.local/beta.html",
  ]);
  assert.equal(result.research.pages_ok, 2);
});

test("runWebGroundedAnswer completes through a real default-browser bridge", async () => {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body || "{}");
    response.setHeader("content-type", "application/json");
    if (request.url === "/search") {
      const port = server.address().port;
      response.end(JSON.stringify({
        results: [
          { title: "Default Evidence One", url: `http://127.0.0.1:${port}/one` },
          { title: "Default Evidence Two", url: `http://127.0.0.1:${port}/two` },
        ],
      }));
      return;
    }
    assert.equal(request.url, "/fetch");
    const isTwo = payload.url.endsWith("/two");
    const title = isTwo ? "Default Evidence Two" : "Default Evidence One";
    response.end(JSON.stringify({
      status: 200,
      url: payload.url,
      final_url: payload.url,
      html: `<html><head><title>${title}</title></head><body><main><h1>${title}</h1><p>Bridge evidence.</p></main></body></html>`,
    }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const bridge = createDefaultBrowserBridge({ endpoint: `http://127.0.0.1:${server.address().port}` });
    const provider = {
      model: "fixture",
      async agenerate(prompt) {
        if (prompt.includes("evidence_pages")) {
          return JSON.stringify({
            answer: "Default Evidence One and Default Evidence Two",
            evidence_pages: "all",
          });
        }
        return JSON.stringify({
          selected_urls: [
            `http://127.0.0.1:${server.address().port}/one`,
            `http://127.0.0.1:${server.address().port}/two`,
          ],
        });
      },
    };
    const result = await runWebGroundedAnswer({
      query: "default bridge evidence",
      providers: ["default_browser"],
      defaultBrowser: bridge,
      provider,
      maxPages: 2,
      searchQueries: ["default bridge evidence"],
      maxSubQueries: 1,
    });
    assert.equal(result.success, true);
    assert.equal(result.selection.search_error_code, "");
    assert.equal(result.selection.fetch_complete, true);
    assert.equal(result.answer_audit.pages_ok, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runWebGroundedAnswer honors maxTotalMs and reports budget", async () => {
  const transport = makeFixtureMapTransport();
  transport.setPage(
    "https://html.duckduckgo.com/html/?q=Budget",
    '<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Ffixture.local%2Fabout.html">About Fixture</a>',
  );
  const calls = [];
  const provider = {
    model: "fixture",
    async agenerate(prompt) {
      calls.push(prompt);
      await new Promise((resolve) => setTimeout(resolve, 30));
      return JSON.stringify({ selected_urls: ["https://fixture.local/about.html"] });
    },
  };
  const result = await runWebGroundedAnswer({
    query: "Budget",
    providers: ["duckduckgo"],
    transport,
    provider,
    maxPages: 1,
    maxTotalMs: 5,
  });
  assert.equal(result.budget.max_total_ms, 5);
  assert.equal(result.budget.exceeded, true);
  assert.equal(calls.length, 1);
  assert.equal(result.answer, "");
});
