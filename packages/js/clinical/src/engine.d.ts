export function applyAction(run: import("./index").ClinicalRun, raw: Record<string, unknown>, options?: Record<string, unknown>): import("./index").ClinicalRun;
export function startRun(init: Record<string, unknown>): import("./index").ClinicalRun;
export function scoreRun(run: import("./index").ClinicalRun, judges?: unknown, options?: Record<string, unknown>): import("./index").ClinicalScore;
export function auditLeaks(run: import("./index").ClinicalRun): void;
export function assertRetrievalUrl(url: string, run: import("./index").ClinicalRun): void;
export function blockQuery(query: string, run: import("./index").ClinicalRun): void;
export function requireOfficialComplete(results: Record<string, unknown>[], expected?: number): void;
export function isVague(query: string): boolean;
export function rejectCreatePayload(body: Record<string, unknown>): Record<string, unknown>;
export function rejectActPayload(body: Record<string, unknown>): Record<string, unknown>;
export function looksPersonal(text: string): boolean;
export function executeRole(role: string, prompt: string, provider?: string): never;
export function loadRecordedFixture(fixtureId?: string): import("./index").ClinicalRun;
export const DEFAULT_VAULT: { get(runId: string): Record<string, unknown>; seal(runId: string, gold: Record<string, unknown>): void };
export const RETRIEVAL_TRACK_STATUS: Record<string, unknown>;
export class ClinicalLab {
  createRun(body: Record<string, unknown>): import("./index").ClinicalRun;
  act(runId: string, body: Record<string, unknown>): import("./index").ClinicalRun;
}
