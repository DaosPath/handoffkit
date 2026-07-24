export * from "@handoffkit/core";
import { ContextDocument, MemoryStore, RunTrace } from "@handoffkit/core";

export class FileTraceStore {
  root: string;
  constructor(init?: { root?: string });
  save(trace: RunTrace | Record<string, unknown>, name?: string): Promise<string>;
  load(nameOrPath: string): Promise<RunTrace>;
  list(): Promise<string[]>;
}

export function writeReportFiles(
  report: { toJSON?: () => unknown; toMarkdown?: () => string } | unknown,
  name: string,
  outputDir?: string,
): Promise<{ jsonPath: string; markdownPath: string }>;

export function loadReportJSON(path: string): Promise<unknown>;

export function readContractInventory(contractsRoot: string): Promise<{
  fixtures: string[];
  schemas: string[];
}>;

export function buildNodeContractParityReport(init?: {
  runtime?: string;
  version?: string;
  contractsRoot?: string;
  expectedFixtures?: string[];
  expectedSchemas?: string[];
}): Promise<import("@handoffkit/core").ContractParityReport>;

export class ProjectIndexer {
  root: string;
  allowedExtensions: Set<string>;
  maxFileSize: number;
  maxFiles: number;
  constructor(init?: {
    root?: string;
    allowedExtensions?: string[];
    maxFileSize?: number;
    maxFiles?: number;
  });
  index(): ContextDocument[];
}

export class JsonMemoryStore extends MemoryStore {
  filePath: string;
  constructor(filePath: string);
}
