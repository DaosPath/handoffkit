import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export class TemplateFile {
  constructor({ path: filePath, content } = {}) {
    this.path = normalizeTemplatePath(filePath);
    this.content = String(content ?? "");
  }

  render(vars = {}) {
    let output = this.content;
    for (const [key, value] of Object.entries(vars)) {
      output = output.replaceAll(`{{ ${key} }}`, String(value));
    }
    return output;
  }

  toJSON() {
    return { path: this.path, content: this.content };
  }
}

export class ProjectTemplate {
  constructor({ name, description = "", files = [], metadata = {} } = {}) {
    this.name = String(name || "").trim();
    this.description = String(description || "");
    this.files = (Array.isArray(files) ? files : []).map((file) =>
      file instanceof TemplateFile ? file : new TemplateFile(file),
    );
    this.metadata = metadata && typeof metadata === "object" ? { ...metadata } : {};
    this.validate();
  }

  validate() {
    if (!this.name) throw new TypeError("ProjectTemplate name is required.");
    if (this.files.length === 0) throw new TypeError(`ProjectTemplate ${this.name} must contain at least one file.`);
    const seen = new Set();
    for (const file of this.files) {
      if (seen.has(file.path)) throw new TypeError(`ProjectTemplate ${this.name} contains duplicate file: ${file.path}`);
      seen.add(file.path);
    }
    return this;
  }

  toJSON() {
    return {
      name: this.name,
      description: this.description,
      files: this.files.map((file) => file.toJSON()),
      metadata: { ...this.metadata },
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  toMarkdown() {
    const files = this.files.map((file) => `- \`${file.path}\``).join("\n") || "- none";
    return [
      `# Project Template: ${this.name}`,
      "",
      "## Description",
      "",
      this.description || "-",
      "",
      "## Files",
      "",
      files,
    ].join("\n");
  }
}

export class ScaffoldResult {
  constructor({ template, root, filesWritten = [], skipped = [], success = true } = {}) {
    this.template = template || "";
    this.root = root || "";
    this.filesWritten = Array.isArray(filesWritten) ? [...filesWritten] : [];
    this.skipped = Array.isArray(skipped) ? [...skipped] : [];
    this.success = Boolean(success);
  }

  toJSON() {
    return {
      template: this.template,
      root: this.root,
      files_written: [...this.filesWritten],
      skipped: [...this.skipped],
      success: this.success,
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  toMarkdown() {
    const written = this.filesWritten.map((file) => `- \`${file}\``).join("\n") || "- none";
    const skipped = this.skipped.map((file) => `- \`${file}\``).join("\n") || "- none";
    return [
      "# Scaffold Result",
      "",
      `Template: ${this.template}`,
      `Root: ${this.root}`,
      `Success: ${this.success}`,
      "",
      "## Files Written",
      "",
      written,
      "",
      "## Skipped",
      "",
      skipped,
    ].join("\n");
  }
}

export class TemplateScaffolder {
  constructor(templates = builtinTemplates()) {
    this.templates = new Map();
    for (const candidate of Array.isArray(templates) ? templates : []) {
      const template = candidate instanceof ProjectTemplate ? candidate : new ProjectTemplate(candidate);
      if (this.templates.has(template.name)) throw new TypeError(`Duplicate template name: ${template.name}`);
      this.templates.set(template.name, template);
    }
  }

  listTemplates() {
    return [...this.templates.keys()].sort();
  }

  get(name) {
    const template = this.templates.get(name);
    if (!template) {
      throw new TypeError(`Unknown template ${name}. Available templates: ${this.listTemplates().join(", ")}`);
    }
    return template;
  }

  async scaffold(projectName, { template = "basic-agent", output = ".", force = false } = {}) {
    const safeProjectName = normalizeProjectName(projectName);
    const selected = this.get(template);
    const outputRoot = path.resolve(output);
    const root = path.resolve(outputRoot, safeProjectName);
    if (!isInside(root, outputRoot) || root === outputRoot) {
      throw new TypeError(`Project path escapes output directory: ${projectName}`);
    }
    await mkdir(root, { recursive: true });
    const filesWritten = [];
    const skipped = [];

    for (const file of selected.files) {
      const destination = path.resolve(root, file.path);
      if (!isInside(destination, root) || destination === root) {
        throw new TypeError(`Template file escapes output directory: ${file.path}`);
      }

      let exists = false;
      try {
        exists = (await stat(destination)).isFile();
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      if (exists && !force) {
        skipped.push(destination);
        continue;
      }

      await atomicWriteFile(destination, file.render({ project_name: safeProjectName }));
      filesWritten.push(destination);
    }

    return new ScaffoldResult({
      template: selected.name,
      root,
      filesWritten,
      skipped,
      success: skipped.length === 0,
    });
  }
}

export function builtinTemplates() {
  return [
    new ProjectTemplate({
      name: "basic-agent",
      description: "Minimal JavaScript HandoffKit agent starter.",
      files: [
        new TemplateFile({
          path: "package.json",
          content: [
            "{",
            "  \"name\": \"{{ project_name }}\",",
            "  \"version\": \"0.1.0\",",
            "  \"type\": \"module\",",
            "  \"private\": true,",
            "  \"packageManager\": \"pnpm@11.1.1\",",
            "  \"engines\": { \"node\": \">=18.17.0\" },",
            "  \"dependencies\": {",
            "    \"@handoffkit/core\": \"^1.14.2\"",
            "  },",
            "  \"scripts\": {",
            "    \"check\": \"node --check main.js\",",
            "    \"start\": \"node main.js\"",
            "  }",
            "}",
            "",
          ].join("\n"),
        }),
        new TemplateFile({
          path: "README.md",
          content: [
            "# {{ project_name }}",
            "",
            "Minimal offline HandoffKit JS agent.",
            "",
            "```bash",
            "pnpm install",
            "pnpm check",
            "pnpm start",
            "```",
            "",
          ].join("\n"),
        }),
        new TemplateFile({
          path: ".gitignore",
          content: ["node_modules/", ".env", "runs/", ""].join("\n"),
        }),
        new TemplateFile({
          path: "main.js",
          content: [
            "import { Agent, HandoffQualityEvaluator, HandoffState } from \"@handoffkit/core\";",
            "",
            "const agent = new Agent({",
            "  name: \"Planner\",",
            "  role: \"Create concise implementation plans.\",",
            "});",
            "",
            "const result = agent.run(\"Plan a tiny local CLI.\");",
            "const handoff = new HandoffState({",
            "  task: \"Plan a tiny local CLI.\",",
            "  fromAgent: \"Planner\",",
            "  toAgent: \"Builder\",",
            "  summary: result.finalOutput,",
            "  decisions: [\"Use @handoffkit/core only.\"],",
            "  importantFiles: [\"main.js\"],",
            "  nextSteps: [\"Implement the CLI\", \"Run pnpm check\"],",
            "  metadata: { errorsChecked: true },",
            "});",
            "",
            "console.log(handoff.toMarkdown());",
            "console.log(new HandoffQualityEvaluator().evaluate(handoff).toMarkdown());",
            "",
          ].join("\n"),
        }),
      ],
    }),
  ];
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

function normalizeTemplatePath(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/");
  if (!raw || raw === "." || raw === ".." || raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) {
    throw new TypeError("TemplateFile path must be a non-empty relative file path.");
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === ".." || normalized.startsWith("../") || normalized.endsWith("/")) {
    throw new TypeError(`TemplateFile path escapes template root: ${value}`);
  }
  return normalized;
}

function normalizeProjectName(value) {
  const name = String(value || "").trim();
  if (!name || name === "." || name === "..") throw new TypeError("projectName must be a non-empty package name.");
  if (name.includes("/") || name.includes("\\") || /[<>:"|?*\x00-\x1f]/.test(name)) {
    throw new TypeError("projectName must be a single safe directory name.");
  }
  if (name.endsWith(".") || name.endsWith(" ") || RESERVED_WINDOWS_NAMES.test(name)) {
    throw new TypeError(`projectName is not portable across platforms: ${name}`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw new TypeError("projectName must be a lowercase npm-compatible name.");
  }
  return name;
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
