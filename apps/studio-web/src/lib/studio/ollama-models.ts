/**
 * Runtime Ollama discovery for the MAI-style Studio panel.
 *
 * The catalog is deliberately built from Ollama's /api/tags response.  The
 * UI may show a requested default while the provider is unavailable, but it
 * must never present a hard-coded model as installed or ready.
 */

import type { NvidiaModelOption } from "./nvidia-models";

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_MODEL = "liquid-2.6b";

export type OllamaModelOption = NvidiaModelOption;

export type OllamaDiscovery = {
  ready: boolean;
  models: OllamaModelOption[];
  errorCode?:
    | "ollama_unavailable"
    | "ollama_invalid_response"
    | "ollama_no_models";
};

type OllamaTagsResponse = {
  models?: Array<{ name?: unknown; model?: unknown }>;
};

function normalizeBaseUrl(value: string): string {
  return (value || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "");
}

function modelLabel(id: string): string {
  const [rawBase, tag] = id.split(":", 2);
  const base = rawBase || id;
  const cleanBase = base.startsWith("hf.co/")
    ? `Hugging Face · ${base.slice("hf.co/".length)}`
    : base
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const prettyBase = cleanBase.replace(
    /\b(\d+(?:\.\d+)?)([bmk])\b/gi,
    (_, value: string, unit: string) => `${value}${unit.toUpperCase()}`,
  );
  return tag ? `${prettyBase} · ${tag}` : prettyBase;
}

export function toOllamaModelOption(id: string): OllamaModelOption {
  const clean = id.trim();
  return {
    id: clean,
    label: modelLabel(clean),
    publisher: "Ollama local",
    blurb: "Installed locally; availability discovered at runtime",
    tier: "fast",
  };
}

export function defaultOllamaPanelModels(model = DEFAULT_OLLAMA_MODEL) {
  return {
    "Expert A": model,
    "Expert B": model,
    "Expert C": model,
    Judge: model,
  } as const;
}

/**
 * Query a local Ollama daemon without throwing or inventing a ready state.
 * A short timeout keeps the Studio status endpoint responsive when Ollama is
 * stopped.  The returned model ids are the exact ids sent back to Ollama.
 */
export async function discoverOllamaModels(
  baseUrl = DEFAULT_OLLAMA_BASE_URL,
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs = 1200,
): Promise<OllamaDiscovery> {
  if (typeof fetchImpl !== "function") {
    return { ready: false, models: [], errorCode: "ollama_unavailable" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(100, timeoutMs));
  try {
    const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/api/tags`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ready: false, models: [], errorCode: "ollama_unavailable" };
    }
    const body = (await response.json()) as OllamaTagsResponse;
    if (!body || !Array.isArray(body.models)) {
      return { ready: false, models: [], errorCode: "ollama_invalid_response" };
    }
    const ids = [...new Set(
      body.models
        .map((entry) => String(entry?.name ?? entry?.model ?? "").trim())
        .filter(Boolean),
    )];
    if (ids.length === 0) {
      return { ready: false, models: [], errorCode: "ollama_no_models" };
    }
    return {
      ready: true,
      models: ids.map(toOllamaModelOption),
    };
  } catch {
    return { ready: false, models: [], errorCode: "ollama_unavailable" };
  } finally {
    clearTimeout(timer);
  }
}
