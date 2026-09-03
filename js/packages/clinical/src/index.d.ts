export const HANDOFFKIT_CLINICAL_VERSION: "1.20.0-v1beta";
export const CONTRACT_VERSION: "1.20.0-v1beta";
export const CONTRACT_FORMAT: "handoffkit.clinical.v1beta";
export const OFFICIAL_CASE_COUNT: 897;
export const STATUS_PUBLIC: string;
export const DATASET_NAME: string;
export const DATASET_URL: string;
export const DATASET_PAPER: string;
export const DATASET_REVISION_PIN: string;
export const OFFICIAL_CORPUS_STATUS: string;
export const EXPERIENCES: readonly string[];
export const TRACKS: readonly string[];
export const ACTIONS: readonly string[];
export const PHASES: readonly string[];
export const ROLES: readonly string[];
export const ERROR_CODES: readonly string[];
export const RESOURCE_UNITS_V1: Readonly<Record<string, number>>;
export const VAGUE_MARKERS: readonly string[];
export const CAPABILITIES: Readonly<Record<string, string>>;
export const PROVIDER_STATUS: Readonly<Record<string, Record<string, unknown>>>;
export const GOLD_FIELDS: readonly string[];

export class ClinicalError extends Error {
  code: string;
  details: Record<string, unknown>;
  constructor(message: string, init?: { code?: string; details?: Record<string, unknown> });
  toWire(): { code: string; message: string; details: Record<string, unknown> };
  toDict(): { code: string; message: string; details: Record<string, unknown> };
}

export class ClinicalAction {
  action_id: string;
  name: string;
  query: string;
  idempotency_key: string;
  role: string;
  constructor(data?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
}

export class ClinicalObservation {
  observation_id: string;
  action_id: string;
  section: string;
  content: string;
  code: string;
  source_hash: string;
  source_fragment: string;
  resource_units: number;
  constructor(data?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
}

export class DifferentialItem {
  label: string;
  percent: number;
  support: string;
  against: string;
  constructor(data?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
}

export class ClinicalScore {
  correct: boolean;
  judge_scores: number[];
  alias_match: boolean;
  exact_match: boolean;
  complete: boolean;
  quorum: number;
  heuristic_only: boolean;
  scoring_mode: string;
  constructor(data?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
}

export class ClinicalErrorModel {
  code: string;
  message: string;
  details: Record<string, unknown>;
  constructor(data?: Record<string, unknown>);
  toWire(): Record<string, unknown>;
}

export class ClinicalRun {
  contract_version: string;
  run_id: string;
  experience: string;
  track: string;
  phase: string;
  status: string;
  blind_id: string;
  opening: string;
  actions: ClinicalAction[];
  observations: ClinicalObservation[];
  differential: DifferentialItem[];
  budget_units: number;
  spent_units: number;
  max_rounds: number;
  rounds: number;
  diagnosis: string;
  score: ClinicalScore | null;
  error: ClinicalErrorModel | null;
  replay: boolean;
  scoring_eligible: boolean;
  status_public: string;
  locale: string;
  evidence: Record<string, unknown>;
  revision: number;
  source: string;
  fixture_id: string;
  sealed: Record<string, unknown>;
  constructor(data?: Record<string, unknown>);
  toWire(options?: { includeSealed?: boolean }): Record<string, unknown>;
}

export class ClinicalClient {
  constructor(options?: { baseUrl?: string; fetchImpl?: typeof fetch });
  manifests(): Promise<{ manifests: Record<string, unknown>[] }>;
  createRun(body: Record<string, unknown>): Promise<ClinicalRun>;
  getRun(runId: string): Promise<ClinicalRun>;
  act(runId: string, body: Record<string, unknown>): Promise<ClinicalRun>;
  createBenchmark(body: Record<string, unknown>): Promise<Record<string, unknown>>;
  getBenchmark(id: string): Promise<Record<string, unknown>>;
  report(id: string): Promise<Record<string, unknown>>;
}

export const PUBLIC_CASES: readonly Record<string, unknown>[];
export const PROFESSIONAL_CASES: readonly Record<string, unknown>[];
