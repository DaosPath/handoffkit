import { Agent, HandoffProtocol, HandoffState } from "@handoffkit/core";

export class RecipeStep {
  constructor(init: {
    name: string;
    task: string;
    agent?: Agent | null;
    useContext?: boolean;
    metadata?: Record<string, unknown>;
  });
  name: string;
  task: string;
  agent: Agent | null;
  useContext: boolean;
  metadata: Record<string, unknown>;
  toJSON(): Record<string, unknown>;
}

export class Recipe {
  constructor(init: {
    name: string;
    description?: string;
    steps?: Array<RecipeStep | ConstructorParameters<typeof RecipeStep>[0]>;
    metadata?: Record<string, unknown>;
  });
  name: string;
  description: string;
  steps: RecipeStep[];
  validate(): this;
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  toMarkdown(): string;
}

export class RecipeRunResult {
  recipeName: string;
  success: boolean;
  finalOutput: string;
  stepResults: Array<Record<string, unknown>>;
  handoffStates: HandoffState[];
  toJSON(): Record<string, unknown>;
  toJSONString(space?: number): string;
  toMarkdown(): string;
}

export class RecipeRunner {
  constructor(recipe: Recipe, options?: { protocol?: HandoffProtocol });
  run(initialTask?: string): RecipeRunResult;
}

export class WorkflowTemplate {
  static sequential(init: {
    name: string;
    agents: Agent[];
    task: string;
    description?: string;
  }): Recipe;
  static planExecuteReview(init: {
    name: string;
    task: string;
    planner: Agent;
    executor: Agent;
    reviewer: Agent;
  }): Recipe;
}

export function planExecuteReviewRecipe(task?: string): Recipe;

export const SAFETY_NOTE: string;
export const DEFAULT_FUSION_TASK: string;
export const DEFAULT_FUSION_MODELS: string;

export class PanelResponse {
  model: string;
  role: string;
  answer: string;
  strengths: string[];
  risks: string[];
  confidence: string;
  constructor(init?: { model: string; role: string; answer: string; strengths?: string[]; risks?: string[]; confidence?: string });
  toDict(): Record<string, unknown>;
  toJSON(): Record<string, unknown>;
}

export class FusionReport {
  success: boolean;
  task: string;
  mode: string;
  panel: PanelResponse[];
  consensus: string[];
  contradictions: string[];
  coverageGaps: string[];
  uniqueInsights: string[];
  blindSpots: string[];
  finalAnswer: string;
  safetyNote: string;
  constructor(init?: { success: boolean; task: string; mode: string; panel: PanelResponse[]; consensus?: string[]; contradictions?: string[]; coverageGaps?: string[]; uniqueInsights?: string[]; blindSpots?: string[]; finalAnswer: string; safetyNote?: string });
  toDict(): Record<string, unknown>;
  toJSON(): Record<string, unknown>;
  toMarkdown(): string;
}

export function splitModels(value: string | null | undefined): string[];
export function offlineFusionPanel(task?: string): PanelResponse[];
export function judgeFusionPanel(task: string, panel: PanelResponse[], options?: { mode?: string }): FusionReport;
export function runModelFusionPanel(options?: { task?: string; provider?: string; models?: string; real?: boolean; timeout?: number }): Promise<FusionReport>;
export function realFusionPanel(provider: string, models: string[], task?: string, options?: { timeout?: number }): Promise<PanelResponse[]>;

export class MediaAsset {
  path: string;
  mediaType: string;
  language: string;
  durationSeconds: number | null;
  metadata: Record<string, unknown>;
  constructor(init?: { path: string; mediaType: string; language?: string; durationSeconds?: number | null; metadata?: Record<string, unknown> });
  toDict(): Record<string, unknown>;
  static fromDict(data: Record<string, unknown>): MediaAsset;
}

export class TranscriptSegment {
  index: number;
  start: number;
  end: number;
  text: string;
  speaker: string;
  language: string;
  metadata: Record<string, unknown>;
  constructor(init?: { index: number; start: number; end: number; text: string; speaker?: string; language?: string; metadata?: Record<string, unknown> });
  toDict(): Record<string, unknown>;
  static fromDict(data: Record<string, unknown>): TranscriptSegment;
}

export class SpeakerProfile {
  speakerId: string;
  label: string;
  voice: string;
  language: string;
  notes: string[];
  metadata: Record<string, unknown>;
  constructor(init?: { speakerId: string; label?: string; voice?: string; language?: string; notes?: string[]; metadata?: Record<string, unknown> });
  toDict(): Record<string, unknown>;
  static fromDict(data: Record<string, unknown>): SpeakerProfile;
}

export class DubbingSegment {
  index: number;
  start: number;
  end: number;
  speaker: string;
  sourceText: string;
  targetText: string;
  voice: string;
  audioPath: string;
  notes: string[];
  metadata: Record<string, unknown>;
  constructor(init?: { index: number; start: number; end: number; speaker: string; sourceText: string; targetText: string; voice?: string; audioPath?: string; notes?: string[]; metadata?: Record<string, unknown> });
  toDict(): Record<string, unknown>;
  static fromDict(data: Record<string, unknown>): DubbingSegment;
}

export class MediaWorkflowReport {
  success: boolean;
  source: MediaAsset;
  targetLanguage: string;
  transcriptSegments: TranscriptSegment[];
  speakers: SpeakerProfile[];
  dubbingSegments: DubbingSegment[];
  outputFiles: string[];
  warnings: string[];
  metadata: Record<string, unknown>;
  constructor(init?: { success: boolean; source: MediaAsset | Record<string, unknown>; targetLanguage: string; transcriptSegments?: TranscriptSegment[]; speakers?: SpeakerProfile[]; dubbingSegments?: DubbingSegment[]; outputFiles?: string[]; warnings?: string[]; metadata?: Record<string, unknown> });
  toDict(): Record<string, unknown>;
  toJSON(): Record<string, unknown>;
  toMarkdown(): string;
}

export function buildDubbingPlan(segments: TranscriptSegment[], translations: Record<number, string>, speakers?: SpeakerProfile[]): DubbingSegment[];
export function formatSRTTimestamp(seconds: number): string;
export function formatSRT(segments: Array<TranscriptSegment | DubbingSegment>, options?: { translated?: boolean }): string;

export function writeTranscriptJSON(segments: TranscriptSegment[], filePath: string): Promise<string>;
export function readTranscriptJSON(filePath: string): Promise<TranscriptSegment[]>;
export function writeSRT(segments: Array<TranscriptSegment | DubbingSegment>, filePath: string, options?: { translated?: boolean }): Promise<string>;
export function ffmpegAvailable(ffmpeg?: string): Promise<boolean>;
export function extractAudio(videoPath: string, audioPath: string, options?: { ffmpeg?: string; overwrite?: boolean }): Promise<MediaAsset>;
export function muxAudio(videoPath: string, audioPath: string, outputPath: string, options?: { ffmpeg?: string; overwrite?: boolean }): Promise<MediaAsset>;
