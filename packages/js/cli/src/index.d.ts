export const VERSION: "1.12.0";

export function runDemo(): string;
export function runRecipeDemo(): string;
export function runShowcase(slug: "coding-review" | "support" | "research"): Promise<string>;
export function renderReport(inputPath: string): Promise<string>;
export function listProviders(options?: { jsonOutput?: boolean }): Promise<string>;
export function initProject(projectName: string, options?: {
  output?: string;
  template?: string;
  force?: boolean;
}): Promise<string>;
export function initProjectInteractive(defaultProjectName: string, options?: {
  output?: string;
  template?: string;
  force?: boolean;
}): Promise<string>;
export function createExtension(name: string, options?: {
  output?: string;
  force?: boolean;
}): Promise<string>;
export function loadDynamicExtensions(registry: any): Promise<void>;
export function setKey(name: string, value: string): Promise<string>;
export function deleteKey(name: string): Promise<string>;
export function listKeys(): Promise<string>;
export function writeProjectReport(projectPath: string, options?: {
  outputDir?: string;
  query?: string;
}): Promise<string>;
export function main(argv?: string[], io?: {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}): Promise<number>;
