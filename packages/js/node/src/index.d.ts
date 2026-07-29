export * from "@handoffkit/core";
import { ContextDocument, MemoryStore, RunTrace } from "@handoffkit/core";
import { MessageEnvelope, Transport } from "@handoffkit/csp";
import { ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";

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

export class NodeStdioTransport extends Transport {
  readable: Readable;
  writable: Writable;
  maxMessageBytes: number;
  constructor(init: { readable: Readable; writable: Writable; maxMessageBytes?: number });
  send(envelope: MessageEnvelope | Record<string, unknown>): Promise<void>;
  receive(): Promise<MessageEnvelope>;
  close(): Promise<void>;
}

export class SubprocessStdioTransport extends NodeStdioTransport {
  child: ChildProcessWithoutNullStreams;
  stderr: Readable;
  constructor(child: ChildProcessWithoutNullStreams, options?: { maxMessageBytes?: number });
  static spawn(
    argv: string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv; maxMessageBytes?: number },
  ): SubprocessStdioTransport;
}

export class FileDedupStore {
  constructor(filePath: string, options?: { capacity?: number; maxLogBytes?: number });
  claim(key: string): boolean;
  release(key: string): boolean;
  contains(key: string): boolean;
  readonly size: number;
}

export class NetworkConfig {
  constructor(init?: { maxMessageBytes?: number; connectTimeoutMs?: number; ioTimeoutMs?: number; maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number });
}
export class LengthDelimitedTransport extends Transport {
  constructor(socket: import("node:net").Socket, options?: { config?: NetworkConfig });
}
export class TcpTransport extends LengthDelimitedTransport {
  static connect(host: string, port: number, options?: { config?: NetworkConfig }): Promise<TcpTransport>;
  static connectWithRetry(host: string, port: number, options?: { config?: NetworkConfig }): Promise<TcpTransport>;
}
export class UnixSocketTransport extends LengthDelimitedTransport {
  static connect(path: string, options?: { config?: NetworkConfig }): Promise<UnixSocketTransport>;
}
