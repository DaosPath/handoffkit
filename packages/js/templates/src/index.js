import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export class TemplateFile {
  constructor({ path: filePath, content } = {}) {
    if (!filePath) throw new TypeError("TemplateFile path is required.");
    this.path = String(filePath).replace(/\\/g, "/");
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
    this.name = String(name || "");
    this.description = String(description || "");
    this.files = (Array.isArray(files) ? files : []).map((file) =>
      file instanceof TemplateFile ? file : new TemplateFile(file),
    );
    this.metadata = metadata ? { ...metadata } : {};
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
    this.templates = new Map(templates.map((template) => [template.name, template]));
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
    if (!String(projectName || "").trim()) {
      throw new TypeError("projectName must be a non-empty string.");
    }
    const selected = this.get(template);
    const root = path.resolve(output, projectName);
    await mkdir(root, { recursive: true });
    const filesWritten = [];
    const skipped = [];

    for (const file of selected.files) {
      const destination = path.resolve(root, file.path);
      if (!isInside(destination, root)) {
        throw new TypeError(`Template file escapes output directory: ${file.path}`);
      }

      let exists = false;
      try {
        await import("node:fs/promises").then((fs) => fs.stat(destination));
        exists = true;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }

      if (exists && !force) {
        skipped.push(destination);
        continue;
      }

      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, file.render({ project_name: projectName }), "utf8");
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
            "  \"dependencies\": {",
            "    \"@handoffkit/core\": \"^1.9.0\"",
            "  },",
            "  \"scripts\": {",
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
            "pnpm start",
            "```",
            "",
          ].join("\n"),
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
            "  nextSteps: [\"Implement the CLI\", \"Run pnpm start\"],",
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

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
