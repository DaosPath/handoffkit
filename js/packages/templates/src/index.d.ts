export class TemplateFile {
  constructor(init: { path: string; content: string });
  path: string;
  content: string;
  render(vars?: Record<string, unknown>): string;
  toJSON(): { path: string; content: string };
}

export class ProjectTemplate {
  constructor(init: {
    name: string;
    description?: string;
    files?: Array<TemplateFile | { path: string; content: string }>;
    metadata?: Record<string, unknown>;
  });
  name: string;
  description: string;
  files: TemplateFile[];
  metadata: Record<string, unknown>;
  validate(): this;
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  toMarkdown(): string;
}

export class ScaffoldResult {
  template: string;
  root: string;
  filesWritten: string[];
  skipped: string[];
  success: boolean;
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  toMarkdown(): string;
}

export class TemplateScaffolder {
  constructor(templates?: ProjectTemplate[]);
  listTemplates(): string[];
  get(name: string): ProjectTemplate;
  scaffold(projectName: string, options?: {
    template?: string;
    output?: string;
    force?: boolean;
  }): Promise<ScaffoldResult>;
}

export function builtinTemplates(): ProjectTemplate[];
