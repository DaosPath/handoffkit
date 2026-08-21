/**
 * Groq chat models usable for Studio multi-agent demos.
 * IDs from https://api.groq.com/openai/v1/models
 * Rates from https://groq.com/pricing (USD per 1M tokens).
 */

import type { NvidiaModelOption } from "./nvidia-models";

export type GroqModelOption = NvidiaModelOption & {
  inputPerM?: number;
  outputPerM?: number;
};

/** Chat / instruct models only (no Whisper / TTS / prompt-guard). */
export const GROQ_CHAT_MODELS: GroqModelOption[] = [
  {
    id: "llama-3.1-8b-instant",
    label: "Llama 3.1 8B Instant",
    publisher: "meta",
    blurb: "Fastest cheap chat · great for Expert C",
    buildUrl: "https://console.groq.com/docs/model/llama-3.1-8b-instant",
    tier: "fast",
    inputPerM: 0.05,
    outputPerM: 0.08,
  },
  {
    id: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B Versatile",
    publisher: "meta",
    blurb: "Strong general reasoning · flagship open",
    buildUrl: "https://console.groq.com/docs/model/llama-3.3-70b-versatile",
    tier: "flagship",
    inputPerM: 0.59,
    outputPerM: 0.79,
  },
  {
    id: "meta-llama/llama-4-scout-17b-16e-instruct",
    label: "Llama 4 Scout",
    publisher: "meta",
    blurb: "MoE scout · strong quality / speed",
    buildUrl:
      "https://console.groq.com/docs/model/meta-llama/llama-4-scout-17b-16e-instruct",
    tier: "flagship",
    inputPerM: 0.11,
    outputPerM: 0.34,
  },
  {
    id: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B",
    publisher: "openai",
    blurb: "Open MoE · efficient reasoning",
    buildUrl: "https://console.groq.com/docs/model/openai/gpt-oss-20b",
    tier: "fast",
    inputPerM: 0.075,
    outputPerM: 0.3,
  },
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    publisher: "openai",
    blurb: "Large open MoE on Groq LPU",
    buildUrl: "https://console.groq.com/docs/model/openai/gpt-oss-120b",
    tier: "flagship",
    inputPerM: 0.15,
    outputPerM: 0.6,
  },
  {
    id: "qwen/qwen3-32b",
    label: "Qwen3 32B",
    publisher: "qwen",
    blurb: "Strong multilingual instruct",
    buildUrl: "https://console.groq.com/docs/model/qwen/qwen3-32b",
    tier: "flagship",
    inputPerM: 0.29,
    outputPerM: 0.59,
  },
  {
    id: "qwen/qwen3.6-27b",
    label: "Qwen3.6 27B",
    publisher: "qwen",
    blurb: "Newer Qwen on Groq",
    buildUrl: "https://console.groq.com/docs/model/qwen/qwen3.6-27b",
    tier: "flagship",
    inputPerM: 0.6,
    outputPerM: 3.0,
  },
  {
    id: "allam-2-7b",
    label: "ALLaM 2 7B",
    publisher: "allam",
    blurb: "Compact multilingual model",
    tier: "fast",
  },
];

export const DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant";

export const DEFAULT_GROQ_PANEL_MODELS = {
  "Expert A": "llama-3.3-70b-versatile",
  "Expert B": "meta-llama/llama-4-scout-17b-16e-instruct",
  "Expert C": "llama-3.1-8b-instant",
  Judge: "llama-3.3-70b-versatile",
} as const;

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export function getGroqRates(modelId: string): {
  inputPerM: number;
  outputPerM: number;
} | null {
  const m = GROQ_CHAT_MODELS.find((x) => x.id === modelId);
  if (!m || m.inputPerM == null || m.outputPerM == null) return null;
  return { inputPerM: m.inputPerM, outputPerM: m.outputPerM };
}

export function estimateGroqUsd(
  modelId: string,
  promptTokens: number,
  completionTokens: number
): number {
  const rates = getGroqRates(modelId);
  if (!rates) return 0;
  return (
    (promptTokens / 1_000_000) * rates.inputPerM +
    (completionTokens / 1_000_000) * rates.outputPerM
  );
}
