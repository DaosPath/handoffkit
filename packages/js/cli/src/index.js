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

export const VERSION = "1.12.0";

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

export async function runRecipeDemo() {
  const { ExtensionRegistry } = await import("@handoffkit/core");
  const registry = new ExtensionRegistry();
  await loadDynamicExtensions(registry);
  const recipe = WorkflowTemplate.planExecuteReview({
    name: "js-release-checklist",
    task: "Prepare a JavaScript CLI release checklist.",
    planner: new Agent({ name: "Planner" }),
    executor: new Agent({ name: "Executor" }),
    reviewer: new Agent({ name: "Reviewer" }),
  });
  const targetRecipe = registry.recipes().length > 0 ? registry.recipes()[0] : recipe;
  return new RecipeRunner(targetRecipe).run("Ship HandoffKit JS CLI.").toMarkdown();
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

export async function initProjectInteractive(defaultProjectName, options = {}) {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const name = (await rl.question(`Project name (${defaultProjectName}): `)).trim() || defaultProjectName;
    const template = (await rl.question("Template (basic-agent): ")).trim() || "basic-agent";
    const provider = (await rl.question("LLM Provider (openai/nvidia/groq/ollama/echo) [openai]: ")).trim() || "openai";
    
    let apiKey = "";
    if (provider !== "echo" && provider !== "ollama") {
      apiKey = (await rl.question(`API Key for ${provider.toUpperCase()}: `)).trim();
    }
    
    rl.close();

    const scaffolder = new TemplateScaffolder();
    const targetDir = options.output === "." ? path.join(process.cwd(), name) : path.join(options.output, name);
    const result = await scaffolder.scaffold(name, { output: options.output, template, force: options.force });

    const envLines = [];
    if (apiKey) {
      const envName = `${provider.toUpperCase()}_API_KEY`;
      envLines.push(`${envName}=${apiKey}`);
    }
    if (envLines.length > 0) {
      await writeFile(path.join(targetDir, ".env"), envLines.join("\n") + "\n", "utf8");
      try {
        let gitignore = await readFile(path.join(targetDir, ".gitignore"), "utf8");
        if (!gitignore.includes(".env")) {
          gitignore += "\n.env\n";
          await writeFile(path.join(targetDir, ".gitignore"), gitignore, "utf8");
        }
      } catch (_) {}
    }

    const config = {
      provider,
      model: provider === "openai" ? "gpt-4o-mini" : (provider === "nvidia" ? "meta/llama-3.1-8b-instruct" : "default")
    };
    await writeFile(path.join(targetDir, "handoff.config.json"), JSON.stringify(config, null, 2), "utf8");

    return [
      result.toMarkdown(),
      "",
      `Configured provider: ${provider}`,
      apiKey ? "Saved API Key to .env" : "No API Key saved",
      "",
      "## Next Commands",
      "",
      "```bash",
      `cd ${name}`,
      "pnpm install",
      "pnpm start",
      "```",
    ].join("\n");
  } catch (error) {
    rl.close();
    throw error;
  }
}

export async function createExtension(name, { output = ".", force = false } = {}) {
  const fs = await import("node:fs/promises");
  const { join, resolve } = await import("node:path");
  
  const extDir = resolve(output, name);
  try {
    await fs.mkdir(extDir, { recursive: true });
  } catch (err) {
    // ignore
  }
  
  const initPath = join(extDir, "index.js");
  const initTypesPath = join(extDir, "index.d.ts");
  const toolsPath = join(extDir, "tools.js");
  const recipesPath = join(extDir, "recipes.js");
  
  if (!force) {
    try {
      await fs.access(initPath);
      throw new Error(`Extension already exists in ${extDir}. Use --force to overwrite.`);
    } catch (err) {
      if (err.message && err.message.includes("already exists")) {
        throw err;
      }
    }
  }
  
  const initContent = `import { Extension } from "@handoffkit/core";
import { miHerramienta } from "./tools.js";
import { miReceta } from "./recipes.js";

export const extension = new Extension({
  name: "${name}",
  description: "Plugin personalizado ${name}",
  version: "1.0.0",
  tools: [miHerramienta],
  recipes: [miReceta]
});
`;

  const initTypesContent = `import { Extension } from "@handoffkit/core";
export const extension: Extension;
`;

  const toolsContent = `import { defineTool } from "@handoffkit/core";

export const miHerramienta = defineTool({
  name: "mi_herramienta",
  description: "Una herramienta de ejemplo.",
  parameters: {
    type: "object",
    properties: {
      param: { type: "string" }
    },
    required: ["param"]
  },
  execute: ({ param }) => {
    return \`Procesado parámetro: \${param}\`;
  }
});
`;

  const recipesContent = `import { Recipe } from "@handoffkit/core";

export const miReceta = new Recipe({
  name: "mi_receta_ejemplo",
  description: "Una receta de ejemplo",
  steps: []
});
`;

  await fs.writeFile(initPath, initContent, "utf8");
  await fs.writeFile(initTypesPath, initTypesContent, "utf8");
  await fs.writeFile(toolsPath, toolsContent, "utf8");
  await fs.writeFile(recipesPath, recipesContent, "utf8");
  
  return `Scaffolded extension ${name} successfully in ${extDir}.`;
}

export async function loadDynamicExtensions(registry) {
  const fs = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const configPath = resolve("handoff.config.json");
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const config = JSON.parse(raw);
    const extensions = config.extensions || [];
    for (const extPath of extensions) {
      const absolutePath = extPath.startsWith(".") ? resolve(extPath) : extPath;
      const fileUrl = absolutePath.startsWith("/") || absolutePath.includes(":") ? `file://${absolutePath.replace(/\\/g, "/")}` : absolutePath;
      const mod = await import(fileUrl);
      if (mod.extension) {
        registry.register(mod.extension);
      }
    }
  } catch (err) {
    // Ignore
  }
}

export async function setKey(name, value) {
  const envPath = path.resolve(".env");
  let content = "";
  try {
    content = await readFile(envPath, "utf8");
  } catch (_) {}

  const lines = content.split(/\r?\n/).filter(Boolean);
  let updated = false;
  const newLines = lines.map(line => {
    const parts = line.split("=");
    if (parts[0] === name) {
      updated = true;
      return `${name}=${value}`;
    }
    return line;
  });

  if (!updated) {
    newLines.push(`${name}=${value}`);
  }

  await writeFile(envPath, newLines.join("\n") + "\n", "utf8");
  return `Set key ${name} successfully in .env`;
}

export async function deleteKey(name) {
  const envPath = path.resolve(".env");
  let content = "";
  try {
    content = await readFile(envPath, "utf8");
  } catch (_) {
    return `No .env file found.`;
  }

  const lines = content.split(/\r?\n/).filter(Boolean);
  const newLines = lines.filter(line => {
    const parts = line.split("=");
    return parts[0] !== name;
  });

  await writeFile(envPath, newLines.join("\n") + "\n", "utf8");
  return `Deleted key ${name} successfully from .env`;
}

export async function listKeys() {
  const envPath = path.resolve(".env");
  let content = "";
  try {
    content = await readFile(envPath, "utf8");
  } catch (_) {
    return "No keys configured (.env not found).";
  }

  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return "No keys configured (.env is empty).";

  const rows = lines.map(line => {
    const parts = line.split("=");
    const key = parts[0];
    const val = parts.slice(1).join("=");
    const redacted = val.length > 8 ? `${val.slice(0, 4)}...${val.slice(-4)} (redacted)` : "[redacted]";
    return `- ${key}=${redacted}`;
  });

  return ["Configured Keys:", ...rows].join("\n");
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
    if (command === "doctor-benchmark" || command === "doctor" || command === "-d") {
      const limit = Number(rest[0] || 30);
      const { runDoctorBenchmark } = await import("./benchmarks/doctor.js");
      const report = await runDoctorBenchmark(limit);
      stdout(report.toMarkdown());
      return 0;
    }
    if (command === "mai-benchmark" || command === "mai" || command === "-m") {
      const limit = Number(rest[0] || 30);
      const { runMAIStyleBenchmark } = await import("./benchmarks/mai.js");
      const report = await runMAIStyleBenchmark(limit);
      stdout(report.toMarkdown());
      return 0;
    }
    if (command === "demo-recipe") {
      stdout(await runRecipeDemo());
      return 0;
    }
    if (command === "create-extension" || command === "init-extension") {
      const name = rest[0];
      if (!name) throw new Error("create-extension requires an extension name.");
      const output = readFlag(rest, "--output") || ".";
      const force = rest.includes("--force");
      stdout(await createExtension(name, { output, force }));
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
    if (command === "demo-media") {
      const { runMediaDemo } = await import("./benchmarks/media_demo.js");
      const { report, markdownPath } = await runMediaDemo();
      stdout(`Media Localization demo complete. Success: ${report.success}`);
      stdout(`Markdown report: ${markdownPath}`);
      return 0;
    }
    if (command === "demo-fusion") {
      const { runFusionDemo } = await import("./benchmarks/fusion_demo.js");
      const { report, markdownPath } = await runFusionDemo();
      stdout(`Fusion demo complete. Success: ${report.success}`);
      stdout(`Markdown report: ${markdownPath}`);
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
      const interactive = rest.includes("--interactive") || rest.includes("-i");
      if (!projectName && !interactive) throw new Error("init requires a project name or --interactive.");
      if (interactive) {
        stdout(await initProjectInteractive(projectName || "my-agent", {
          output: readFlag(rest, "--output") || ".",
          template: readFlag(rest, "--template") || "basic-agent",
          force: rest.includes("--force"),
        }));
      } else {
        stdout(await initProject(projectName, {
          output: readFlag(rest, "--output") || ".",
          template: readFlag(rest, "--template") || "basic-agent",
          force: rest.includes("--force"),
        }));
      }
      return 0;
    }
    if (command === "keys") {
      const sub = rest[0];
      if (sub === "set") {
        const name = rest[1];
        const val = rest[2];
        if (!name || !val) throw new Error("keys set requires a key name and value.");
        stdout(await setKey(name, val));
        return 0;
      }
      if (sub === "delete" || sub === "remove") {
        const name = rest[1];
        if (!name) throw new Error("keys delete requires a key name.");
        stdout(await deleteKey(name));
        return 0;
      }
      if (sub === "list") {
        stdout(await listKeys());
        return 0;
      }
      throw new Error("keys requires subcommand: set, list, or delete.");
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
    "  handoffkit-js demo-recipe",
    "  handoffkit-js doctor-benchmark [limit]  (alias: doctor, -d)",
    "  handoffkit-js mai-benchmark [limit]     (alias: mai, -m)",
    "  handoffkit-js demo-coding-review",
    "  handoffkit-js demo-support",
    "  handoffkit-js demo-research",
    "  handoffkit-js demo-media",
    "  handoffkit-js demo-fusion",
    "  handoffkit-js report <path>",
    "  handoffkit-js project-report [path] [--output reports]",
    "  handoffkit-js providers list [--json]",
    "  handoffkit-js init <project-name> [--template basic-agent] [--output .] [--force] [--interactive]",
    "  handoffkit-js create-extension <extension-name> [--output .] [--force]",
    "  handoffkit-js keys set <name> <value>",
    "  handoffkit-js keys list",
    "  handoffkit-js keys delete <name>",
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
