import { NextResponse } from "next/server";
import {
  defaultMaiExperts,
  runMaiStylePanel,
  type MaiPanelEvent,
  type MaiPanelRole,
  type StudioProviderId,
} from "@/lib/studio/mai-panel-runner";
import {
  DEFAULT_NVIDIA_MODEL,
  DEFAULT_PANEL_MODELS,
  NVIDIA_FREE_MODELS,
} from "@/lib/studio/nvidia-models";
import {
  DEFAULT_GROQ_MODEL,
  DEFAULT_GROQ_PANEL_MODELS,
  GROQ_BASE_URL,
  GROQ_CHAT_MODELS,
} from "@/lib/studio/groq-models";
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  defaultOllamaPanelModels,
  discoverOllamaModels,
} from "@/lib/studio/ollama-models";
import {
  buildStoredRun,
  saveStoredRunWithStudio,
} from "@/lib/studio/run-history";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  task?: string;
  provider?: StudioProviderId;
  model?: string;
  judgeModel?: string;
  /** Per-expert model overrides: { "Expert A": "…", ... } */
  expertModels?: Record<string, string>;
  experts?: MaiPanelRole[];
  offline?: boolean;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  /** Optional case preset id for history / future benchmarks */
  casePreset?: string;
};

function resolveProvider(body: Body): StudioProviderId {
  if (body.provider === "ollama") return "ollama";
  return body.provider === "groq" ? "groq" : "nvidia";
}

function resolveExperts(
  body: Body,
  fallbackModel: string,
  provider: StudioProviderId
): MaiPanelRole[] {
  const defaults =
    provider === "ollama"
      ? defaultOllamaPanelModels(fallbackModel)
      : provider === "groq"
        ? DEFAULT_GROQ_PANEL_MODELS
        : DEFAULT_PANEL_MODELS;
  if (Array.isArray(body.experts) && body.experts.length > 0) {
    return body.experts.map((e) => ({
      name: e.name,
      role: e.role,
      model: e.model || fallbackModel,
    }));
  }
  const per = body.expertModels || {};
  return defaultMaiExperts(fallbackModel, {
    "Expert A": per["Expert A"] || defaults["Expert A"] || fallbackModel,
    "Expert B": per["Expert B"] || defaults["Expert B"] || fallbackModel,
    "Expert C": per["Expert C"] || defaults["Expert C"] || fallbackModel,
  });
}

/**
 * POST /api/demos/mai-panel
 * Real MAI-style panel via @handoffkit/core + local Ollama, NVIDIA NIM, or Groq.
 * Supports per-agent models + stream:true NDJSON progress.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const task = typeof body.task === "string" ? body.task : "";
    const stream = body.stream === true;
    const providerId = resolveProvider(body);
    const defaults =
      providerId === "ollama"
        ? defaultOllamaPanelModels(
            body.model || process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
          )
        : providerId === "groq"
          ? DEFAULT_GROQ_PANEL_MODELS
          : DEFAULT_PANEL_MODELS;
    const fallbackModel =
      body.model ||
      (providerId === "ollama"
        ? process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL
        : providerId === "groq"
          ? process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL
          : process.env.NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL);
    const experts = resolveExperts(body, fallbackModel, providerId);
    const judgeModel =
      body.judgeModel || defaults.Judge || fallbackModel;

    const runOpts = {
      task,
      providerId,
      model: fallbackModel,
      judgeModel,
      experts,
      offline: body.offline === true,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
    };

    const casePreset =
      typeof body.casePreset === "string" ? body.casePreset : undefined;

    if (!stream) {
      const result = await runMaiStylePanel(runOpts);
      try {
        const stored = await saveStoredRunWithStudio(
          buildStoredRun({ result, casePreset })
        );
        return NextResponse.json({
          ok: result.success,
          result: { ...result, runId: stored.id },
          historyId: stored.id,
        });
      } catch {
        return NextResponse.json({ ok: result.success, result });
      }
    }

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const send = (
          event: MaiPanelEvent | { type: "error"; message: string }
        ) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };

        try {
          const result = await runMaiStylePanel({
            ...runOpts,
            onEvent: async (event) => {
              if (event.type === "run_complete") {
                try {
                  const stored = await saveStoredRunWithStudio(
                    buildStoredRun({
                      result: event.result,
                      casePreset,
                    })
                  );
                  send({
                    ...event,
                    result: { ...event.result, runId: stored.id },
                  } as MaiPanelEvent);
                  return;
                } catch {
                  /* still send original */
                }
              }
              send(event);
            },
          });
          // If onEvent already forwarded run_complete, nothing else to do
          void result;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          send({ type: "error", message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  const nvidiaKey = Boolean(
    process.env.NVIDIA_API_KEY || process.env.OPENAI_API_KEY
  );
  const groqKey = Boolean(process.env.GROQ_API_KEY);
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
  const ollama = await discoverOllamaModels(ollamaBaseUrl);
  const requested = process.env.MAI_DEFAULT_PROVIDER;
  const defaultProvider: StudioProviderId =
    requested === "ollama" && ollama.ready
      ? "ollama"
      : requested === "groq" && groqKey
        ? "groq"
        : requested === "nvidia" && nvidiaKey
          ? "nvidia"
          : ollama.ready
            ? "ollama"
            : nvidiaKey
              ? "nvidia"
              : groqKey
                ? "groq"
                : "ollama";
  const ollamaModel =
    process.env.OLLAMA_MODEL || ollama.models[0]?.id || DEFAULT_OLLAMA_MODEL;
  const ollamaPanelModels = defaultOllamaPanelModels(ollamaModel);
  const anyReady = nvidiaKey || groqKey || ollama.ready;

  return NextResponse.json({
    demo: "mai-style-panel",
    providers: {
      nvidia: {
        id: "nvidia",
        label: "NVIDIA NIM",
        ready: nvidiaKey,
        defaultModel: process.env.NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL,
        defaultPanelModels: DEFAULT_PANEL_MODELS,
        models: NVIDIA_FREE_MODELS,
        baseUrl:
          process.env.NVIDIA_BASE_URL ||
          "https://integrate.api.nvidia.com/v1",
        costNote: "Free trial endpoints when available ($0).",
      },
      ollama: {
        id: "ollama",
        label: "Ollama local",
        ready: ollama.ready,
        defaultModel: ollamaModel,
        defaultPanelModels: ollamaPanelModels,
        models: ollama.models,
        baseUrl: ollamaBaseUrl,
        costNote: "Local provider; no cloud billing. Model list is runtime-discovered.",
        ...(ollama.errorCode ? { errorCode: ollama.errorCode } : {}),
      },
      groq: {
        id: "groq",
        label: "Groq",
        ready: groqKey,
        defaultModel: process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
        defaultPanelModels: DEFAULT_GROQ_PANEL_MODELS,
        models: GROQ_CHAT_MODELS,
        baseUrl: process.env.GROQ_BASE_URL || GROQ_BASE_URL,
        costNote: "Billable on-demand · rates from groq.com/pricing",
      },
    },
    defaultProvider,
    ready: anyReady,
    mode: anyReady ? (ollama.ready && defaultProvider === "ollama" ? "live-local" : "live") : "provider-unavailable",
    // Back-compat fields (NVIDIA-first)
    provider:
      defaultProvider === "ollama"
        ? "Ollama local"
        : defaultProvider === "groq"
          ? "Groq"
          : "NVIDIA NIM",
    defaultModel:
      defaultProvider === "ollama"
        ? ollamaModel
        : defaultProvider === "groq"
          ? process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL
          : process.env.NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL,
    defaultPanelModels:
      defaultProvider === "ollama"
        ? ollamaPanelModels
        : defaultProvider === "groq"
          ? DEFAULT_GROQ_PANEL_MODELS
          : DEFAULT_PANEL_MODELS,
    models:
      defaultProvider === "ollama"
        ? ollama.models
        : defaultProvider === "groq"
          ? GROQ_CHAT_MODELS
          : NVIDIA_FREE_MODELS,
    baseUrl:
      defaultProvider === "ollama"
        ? ollamaBaseUrl
        : defaultProvider === "groq"
          ? process.env.GROQ_BASE_URL || GROQ_BASE_URL
          : process.env.NVIDIA_BASE_URL ||
            "https://integrate.api.nvidia.com/v1",
    stream: true,
    hint:
      anyReady
        ? "POST { task, provider: 'ollama'|'nvidia'|'groq', expertModels, judgeModel, stream: true }"
        : "Start Ollama locally or configure NVIDIA_API_KEY/GROQ_API_KEY; no Echo fallback is implicit.",
  });
}
