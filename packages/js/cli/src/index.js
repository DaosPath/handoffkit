import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  Agent,
  EchoProvider,
  HandoffQualityEvaluator,
  HandoffState,
  RunTrace,
  Team,
} from "@handoffkit/core";
import {
  ProjectIndexer,
  writeReportFiles,
} from "@handoffkit/node";

import {
  RecipeRunner,
  WorkflowTemplate,
} from "../../recipes/src/index.js";
import {
  TemplateScaffolder,
} from "../../templates/src/index.js";

export const VERSION = "1.9.0";

const SHOWCASES = {
  "coding-review": {
    title: "Coding Agents",
    command: "demo-coding-review",
    task: "Review a small CLI change and prepare test evidence.",
    agents: [
      ["Architect", "Plan implementation boundaries and files."],
      ["Coder", "Implement the change from structured state."],
      ["Reviewer", "Review behavior, risks, and missing tests."],
      ["Tester", "Run final verification and report evidence."],
    ],
    decisions: ["Keep CLI behavior deterministic.", "Report changed files and commands."],
    files: ["src/index.js", "test/cli.test.js"],
    nextSteps: ["Run node --test", "Inspect generated report"],
  },
  "support": {
    title: "Customer Support Escalation",
    command: "demo-support",
    task: "Escalate a billing issue with audit-ready context.",
    agents: [
      ["Triage", "Classify the support request."],
      ["Billing", "Inspect billing state and policy."],
      ["Refund", "Prepare the refund decision."],
      ["Supervisor", "Approve final customer response."],
    ],
    decisions: ["Keep customer-visible response separate from audit notes."],
    files: ["support-ticket.json", "refund-policy.md"],
    nextSteps: ["Send approved response", "Attach report to ticket"],
  },
  "research": {
    title: "Research Workflow",
    command: "demo-research",
    task: "Summarize a research question with source traceability.",
    agents: [
      ["Researcher", "Collect candidate sources."],
      ["Extractor", "Extract claims and citations."],
      ["FactChecker", "Check claims against cited evidence."],
      ["Writer", "Write concise final synthesis."],
    ],
    decisions: ["Every claim needs a source reference.", "Unverified claims stay out of final output."],
    files: ["sources.json", "notes.md"],
    nextSteps: ["Review citations", "Publish summary"],
  },
};

export function runDemo() {
  const team = new Team({
    agents: [
      new Agent({ name: "Planner", role: "Plan the local JS workflow.", provider: new EchoProvider({ model: "offline-js" }) }),
      new Agent({ name: "Builder", role: "Build from the structured handoff.", provider: new EchoProvider({ model: "offline-js" }) }),
      new Agent({ name: "Verifier", role: "Verify the result and report evidence.", provider: new EchoProvider({ model: "offline-js" }) }),
    ],
    metadata: { cli: "handoffkit-js", demo: "basic" },
  });
  const result = team.run("Create a small autonomous HandoffKit JS CLI demo.");
  const trace = RunTrace.fromTeamResult(result, { name: "handoffkit-js-demo" });
  return [
    "HandoffKit JS demo",
    "Protocol: hybrid_state",
    `Agents: ${team.agents.map((agent) => agent.name).join(", ")}`,
    `Handoffs: ${result.handoffs.length}`,
    `Trace steps: ${trace.steps.length}`,
    "",
    result.finalOutput,
  ].join("\n");
}

export function runRecipeDemo() {
  const recipe = WorkflowTemplate.planExecuteReview({
    name: "js-release-checklist",
    task: "Prepare a JavaScript CLI release checklist.",
    planner: new Agent({ name: "Planner" }),
    executor: new Agent({ name: "Executor" }),
    reviewer: new Agent({ name: "Reviewer" }),
  });
  return new RecipeRunner(recipe).run("Ship HandoffKit JS CLI.").toMarkdown();
}

export async function runShowcase(slug) {
  const showcase = SHOWCASES[slug];
  if (!showcase) {
    throw new TypeError(`Unknown demo ${slug}. Available demos: ${Object.keys(SHOWCASES).join(", ")}`);
  }

  const team = new Team({
    agents: showcase.agents.map(([name, role]) =>
      new Agent({ name, role, provider: new EchoProvider({ model: "offline-js" }) }),
    ),
    metadata: { showcase: slug, offline: true },
  });
  const result = team.run(showcase.task);
  const trace = RunTrace.fromTeamResult(result, { name: slug });
  const handoff = new HandoffState({
    task: showcase.task,
    fromAgent: showcase.agents[0][0],
    toAgent: showcase.agents.at(-1)[0],
    summary: result.finalOutput,
    decisions: showcase.decisions,
    importantFiles: showcase.files,
    nextSteps: showcase.nextSteps,
    contextRefs: [`handoffkit-js ${showcase.command}`],
    metadata: { errorsChecked: true, showcase: slug },
  });
  const quality = new HandoffQualityEvaluator().evaluate(handoff);
  const report = {
    kind: "handoffkit-js-showcase",
    showcase: slug,
    title: showcase.title,
    success: result.success && quality.success,
    agents: showcase.agents.map(([name]) => name),
    handoff_count: result.handoffs.length,
    final_output: result.finalOutput,
    handoff: handoff.toJSON(),
    quality: quality.toJSON(),
    trace: trace.toJSON(),
  };

  await writeLatestRun(report, trace);
  return renderShowcaseMarkdown(report);
}

export async function renderReport(inputPath) {
  const target = path.resolve(inputPath);
  const info = await stat(target);
  if (info.isDirectory()) {
    const markdownPath = path.join(target, "report.md");
    try {
      return await readFile(markdownPath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    for (const name of ["report.json", "trace.json"]) {
      try {
        return await renderReport(target ? path.join(target, name) : name);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    throw new Error(`No report.md, report.json, or trace.json found in ${target}`);
  }

  if (target.endsWith(".md")) {
    return readFile(target, "utf8");
  }

  const payload = JSON.parse(await readFile(target, "utf8"));
  if (payload.kind === "handoffkit-js-showcase") {
    return renderShowcaseMarkdown(payload);
  }
  if (payload.run_id || payload.steps) {
    return RunTrace.fromJSON(payload).toTimeline();
  }
  return [
    "# HandoffKit JS Report",
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n");
}

export async function listProviders({ jsonOutput = false } = {}) {
  const providers = [
    {
      name: "echo",
      package: "@handoffkit/core",
      default_model: "echo-js",
      offline: true,
      env: [],
      description: "Deterministic local provider for demos and tests.",
    },
    {
      name: "openai",
      package: "@handoffkit/core",
      default_model: "gpt-4o-mini",
      offline: false,
      env: ["OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL"],
      description: "OpenAI-compatible chat completions provider.",
    },
    {
      name: "ollama",
      package: "@handoffkit/core",
      default_model: "llama3.1",
      offline: false,
      env: ["OLLAMA_HOST"],
      description: "Local Ollama generate endpoint provider.",
    },
  ];

  let providerPackage = null;
  try {
    providerPackage = await import("@handoffkit/providers");
  } catch (_) {
    providerPackage = null;
  }

  const payload = {
    mode: providerPackage ? "providers-package" : "offline-core",
    providers,
  };
  if (jsonOutput) return JSON.stringify(payload, null, 2);

  const lines = ["HandoffKit JS providers", `Mode: ${payload.mode}`, ""];
  for (const provider of providers) {
    lines.push(`- ${provider.name}: ${provider.description}`);
    lines.push(`  package: ${provider.package}`);
    lines.push(`  default: ${provider.default_model}`);
    lines.push(`  offline: ${provider.offline}`);
    lines.push(`  env: ${provider.env.join(", ") || "none"}`);
  }
  return lines.join("\n");
}

export async function initProject(projectName, { output = ".", template = "basic-agent", force = false } = {}) {
  const scaffolder = new TemplateScaffolder();
  const result = await scaffolder.scaffold(projectName, { output, template, force });
  return [
    result.toMarkdown(),
    "",
    "## Next Commands",
    "",
    "```bash",
    `cd ${projectName}`,
    "pnpm install",
    "pnpm start",
    "```",
  ].join("\n");
}

export async function writeProjectReport(projectPath, { outputDir = "reports", query = "handoffkit" } = {}) {
  const docs = new ProjectIndexer({ root: projectPath }).index();
  const report = {
    toJSON() {
      return {
        kind: "handoffkit-js-project-report",
        root: path.resolve(projectPath),
        query,
        document_count: docs.length,
        documents: docs.slice(0, 20).map((doc) => doc.toJSON()),
      };
    },
    toMarkdown() {
      const rows = docs.slice(0, 20).map((doc) => `- \`${doc.path}\`: ${doc.summary}`).join("\n") || "- none";
      return [
        "# HandoffKit JS Project Report",
        "",
        `Root: ${path.resolve(projectPath)}`,
        `Documents: ${docs.length}`,
        "",
        "## Documents",
        "",
        rows,
      ].join("\n");
    },
  };
  const files = await writeReportFiles(report, "project-report", outputDir);
  return `HandoffKit JS project report\nJSON: ${files.jsonPath}\nMarkdown: ${files.markdownPath}`;
}

export async function main(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || ((text) => console.log(text));
  const stderr = io.stderr || ((text) => console.error(text));

  try {
    if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
      stdout(helpText());
      return 0;
    }
    if (argv[0] === "--version" || argv[0] === "-v") {
      stdout(`handoffkit-js ${VERSION}`);
      return 0;
    }

    const [command, ...rest] = argv;
    if (command === "demo") {
      stdout(runDemo());
      return 0;
    }
    if (command === "demo-recipe") {
      stdout(runRecipeDemo());
      return 0;
    }
    if (command === "demo-coding-review") {
      stdout(await runShowcase("coding-review"));
      return 0;
    }
    if (command === "demo-support") {
      stdout(await runShowcase("support"));
      return 0;
    }
    if (command === "demo-research") {
      stdout(await runShowcase("research"));
      return 0;
    }
    if (command === "report") {
      const reportPath = rest[0];
      if (!reportPath) throw new Error("report requires a path.");
      stdout(await renderReport(reportPath));
      return 0;
    }
    if (command === "providers") {
      if (rest[0] !== "list") throw new Error("providers requires subcommand: list.");
      stdout(await listProviders({ jsonOutput: rest.includes("--json") }));
      return 0;
    }
    if (command === "init") {
      const projectName = rest[0];
      if (!projectName) throw new Error("init requires a project name.");
      stdout(await initProject(projectName, {
        output: readFlag(rest, "--output") || ".",
        template: readFlag(rest, "--template") || "basic-agent",
        force: rest.includes("--force"),
      }));
      return 0;
    }
    if (command === "project-report") {
      stdout(await writeProjectReport(rest[0] || ".", {
        outputDir: readFlag(rest, "--output") || "reports",
      }));
      return 0;
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function helpText() {
  return [
    "HandoffKit JS CLI",
    "",
    "Usage:",
    "  handoffkit-js --version",
    "  handoffkit-js demo",
    "  handoffkit-js demo-coding-review",
    "  handoffkit-js demo-support",
    "  handoffkit-js demo-research",
    "  handoffkit-js report <path>",
    "  handoffkit-js providers list [--json]",
    "  handoffkit-js init <project-name> [--template basic-agent] [--output .] [--force]",
  ].join("\n");
}

function readFlag(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  return argv[index + 1] || null;
}

async function writeLatestRun(report, trace) {
  const root = path.resolve("runs", "latest");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "report.json"), JSON.stringify(report, null, 2), "utf8");
  await writeFile(path.join(root, "report.md"), renderShowcaseMarkdown(report), "utf8");
  await writeFile(path.join(root, "trace.json"), trace.toJSONString(2), "utf8");
}

function renderShowcaseMarkdown(report) {
  const quality = report.quality || {};
  const agents = (report.agents || []).join(" -> ");
  return [
    `# ${report.title}`,
    "",
    `Success: ${report.success}`,
    `Agents: ${agents}`,
    `Handoffs: ${report.handoff_count}`,
    `Quality: ${quality.grade ?? "-"} (${quality.score ?? "-"})`,
    "",
    "## Final Output",
    "",
    report.final_output || "-",
    "",
    "## Files",
    "",
    (report.handoff?.important_files || []).map((file) => `- \`${file}\``).join("\n") || "- none",
    "",
    "## Next Steps",
    "",
    (report.handoff?.next_steps || []).map((step) => `- ${step}`).join("\n") || "- none",
  ].join("\n");
}
