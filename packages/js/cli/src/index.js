import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

import { RecipeRunner, WorkflowTemplate } from "@handoffkit/recipes";
import { TemplateScaffolder } from "@handoffkit/templates";

export const VERSION = "1.14.2";

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
  ];

  let mode = "offline-core";
  try {
    const providerPackage = await import("@handoffkit/providers");
    const specs = providerPackage.listProviderSpecs?.() ?? [];
    for (const spec of specs) {
      providers.push({
        name: spec.id,
        package: "@handoffkit/providers",
        default_model: spec.defaultModel || "",
        offline: spec.id === "ollama",
        env: [spec.apiKeyEnv, spec.modelEnv, spec.baseURLEnv].filter(Boolean),
        description: `${spec.name} via ${spec.protocol}.`,
      });
    }
    mode = "providers-package";
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    providers.push(
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
        offline: true,
        env: ["OLLAMA_HOST"],
        description: "Local Ollama generate endpoint provider.",
      },
    );
  }

  const payload = { mode, providers };
  if (jsonOutput) return JSON.stringify(payload, null, 2);

  const lines = ["HandoffKit JS providers", `Mode: ${payload.mode}`, ""];
  for (const provider of providers) {
    lines.push(`- ${provider.name}: ${provider.description}`);
    lines.push(`  package: ${provider.package}`);
    lines.push(`  default: ${provider.default_model || "none"}`);
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
    const provider = validateProviderId((await rl.question("LLM Provider (openai/nvidia/groq/ollama/echo) [openai]: ")).trim() || "openai");
    
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
    await atomicWriteFile(path.join(targetDir, "handoff.config.json"), JSON.stringify(config, null, 2));

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
  const extensionName = validateExtensionName(name);
  const outputRoot = path.resolve(output);
  const extensionRoot = path.resolve(outputRoot, extensionName);
  if (!isInside(extensionRoot, outputRoot) || extensionRoot === outputRoot) {
    throw new TypeError(`Extension path escapes output directory: ${name}`);
  }
  await mkdir(extensionRoot, { recursive: true });

  const indexPath = path.join(extensionRoot, "index.js");
  if (!force) {
    try {
      await stat(indexPath);
      throw new Error(`Extension already exists in ${extensionRoot}. Use --force to overwrite.`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  const quotedName = JSON.stringify(extensionName);
  const files = new Map([
    ["index.js", `import { Extension } from "@handoffkit/core";\nimport { miHerramienta } from "./tools.js";\nimport { miReceta } from "./recipes.js";\n\nexport const extension = new Extension({\n  name: ${quotedName},\n  description: "Custom HandoffKit extension",\n  version: "0.1.0",\n  tools: [miHerramienta],\n  recipes: [miReceta],\n});\n`],
    ["index.d.ts", `import { Extension } from "@handoffkit/core";\nexport const extension: Extension;\n`],
    ["tools.js", `import { defineTool } from "@handoffkit/core";\n\nexport const miHerramienta = defineTool({\n  name: "mi_herramienta",\n  description: "Example extension tool.",\n  parameters: {\n    type: "object",\n    properties: { param: { type: "string" } },\n    required: ["param"],\n  },\n  execute: ({ param }) => \`Processed parameter: \${param}\`,\n});\n`],
    ["recipes.js", `import { Recipe } from "@handoffkit/recipes";\n\nexport const miReceta = new Recipe({\n  name: "mi_receta_ejemplo",\n  description: "Example extension recipe",\n  steps: [],\n});\n`],
    ["package.json", `${JSON.stringify({
      name: extensionName,
      version: "0.1.0",
      private: true,
      type: "module",
      engines: { node: ">=18.17.0" },
      dependencies: {
        "@handoffkit/core": "^1.14.2",
        "@handoffkit/recipes": "^1.14.2",
      },
      scripts: { check: "node --check index.js && node --check tools.js && node --check recipes.js" },
    }, null, 2)}\n`],
    [".gitignore", "node_modules/\n.env\n"],
  ]);

  await Promise.all([...files].map(([relative, content]) => atomicWriteFile(path.join(extensionRoot, relative), content)));
  return `Scaffolded extension ${extensionName} successfully in ${extensionRoot}.`;
}

export async function loadDynamicExtensions(registry) {
  const configPath = path.resolve("handoff.config.json");
  let config;
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return;
    if (error instanceof SyntaxError) {
      throw new SyntaxError(`Invalid extension configuration ${configPath}: ${error.message}`, { cause: error });
    }
    throw error;
  }
  const extensions = config.extensions ?? [];
  if (!Array.isArray(extensions)) throw new TypeError("handoff.config.json extensions must be an array.");

  for (const entry of extensions) {
    if (typeof entry !== "string" || !entry.trim()) throw new TypeError("Each extension path must be a non-empty string.");
    const value = entry.trim();
    const specifier = value.startsWith(".") || path.isAbsolute(value)
      ? pathToFileURL(path.resolve(value)).href
      : value;
    let module;
    try {
      module = await import(specifier);
    } catch (cause) {
      throw new Error(`Failed to load HandoffKit extension ${value}: ${cause.message}`, { cause });
    }
    if (!module.extension) throw new TypeError(`Extension module ${value} must export 'extension'.`);
    registry.register(module.extension);
  }
}

export async function setKey(name, value) {
  const envPath = path.resolve(".env");
  await writeEnvKey(envPath, name, value);
  return `Set key ${name} successfully in .env`;
}

export async function deleteKey(name) {
  const envKey = validateEnvKey(name);
  const envPath = path.resolve(".env");
  let content;
  try {
    content = await readFile(envPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "No .env file found.";
    throw error;
  }
  const lines = content.split(/\r?\n/);
  const filtered = lines.filter((line) => parseEnvAssignment(line)?.key !== envKey);
  await atomicWriteFile(envPath, normalizeEnvLines(filtered));
  return `Deleted key ${envKey} successfully from .env`;
}

export async function listKeys() {
  const envPath = path.resolve(".env");
  let content;
  try {
    content = await readFile(envPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "No keys configured (.env not found).";
    throw error;
  }
  const keys = content.split(/\r?\n/).map(parseEnvAssignment).filter(Boolean).map((entry) => entry.key);
  if (keys.length === 0) return "No keys configured (.env is empty).";
  return ["Configured Keys:", ...keys.map((key) => `- ${key}=[redacted]`)].join("\n");
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
      const limit = parsePositiveInteger(rest[0] ?? "30", "doctor benchmark limit");
      const { runDoctorBenchmark } = await import("./benchmarks/doctor.js");
      const report = await runDoctorBenchmark(limit);
      stdout(report.toMarkdown());
      return 0;
    }
    if (command === "mai-benchmark" || command === "mai" || command === "-m") {
      const limit = parsePositiveInteger(rest[0] ?? "30", "MAI benchmark limit");
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
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new TypeError(`${label} must be a positive integer.`);
  return parsed;
}

function validateExtensionName(value) {
  const name = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name) || name === "." || name === "..") {
    throw new TypeError("Extension name must be a lowercase npm-compatible name.");
  }
  return name;
}

function validateProviderId(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(provider)) throw new TypeError("Provider id contains invalid characters.");
  return provider;
}

function validateEnvKey(value) {
  const key = String(value || "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new TypeError("Environment key must match [A-Za-z_][A-Za-z0-9_]*.");
  return key;
}

function validateEnvValue(value) {
  const text = String(value ?? "");
  if (/[\r\n\0]/.test(text)) throw new TypeError("Environment values cannot contain newlines or NUL characters.");
  return text;
}

function parseEnvAssignment(line) {
  const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
  return match ? { key: match[1], value: match[2] } : null;
}

function normalizeEnvLines(lines) {
  const content = lines.join("\n").replace(/\n+$/, "");
  return content ? `${content}\n` : "";
}

async function writeEnvKey(filePath, name, value) {
  const key = validateEnvKey(name);
  const safeValue = validateEnvValue(value);
  let content = "";
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const lines = content.split(/\r?\n/);
  let updated = false;
  const next = lines.map((line) => {
    if (parseEnvAssignment(line)?.key !== key) return line;
    updated = true;
    return `${key}=${safeValue}`;
  });
  if (!updated) next.push(`${key}=${safeValue}`);
  await atomicWriteFile(filePath, normalizeEnvLines(next));
}

async function atomicWriteFile(filePath, content) {
  const destination = path.resolve(filePath);
  const directory = path.dirname(destination);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(destination)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function writeLatestRun(report, trace) {
  const root = path.resolve("runs", "latest");
  await Promise.all([
    atomicWriteFile(path.join(root, "report.json"), JSON.stringify(report, null, 2)),
    atomicWriteFile(path.join(root, "report.md"), renderShowcaseMarkdown(report)),
    atomicWriteFile(path.join(root, "trace.json"), trace.toJSONString(2)),
  ]);
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
