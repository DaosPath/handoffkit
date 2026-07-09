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
import { buildStoredRun, saveStoredRun } from "@/lib/studio/run-history";

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
  return body.provider === "groq" ? "groq" : "nvidia";
}

function resolveExperts(
  body: Body,
  fallbackModel: string,
  provider: StudioProviderId
): MaiPanelRole[] {
  const defaults =
    provider === "groq" ? DEFAULT_GROQ_PANEL_MODELS : DEFAULT_PANEL_MODELS;
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
 * Real MAI-style panel via @handoffkit/core + NVIDIA NIM or Groq.
 * Supports per-agent models + stream:true NDJSON progress.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const task = typeof body.task === "string" ? body.task : "";
    const stream = body.stream === true;
    const providerId = resolveProvider(body);
    const defaults =
      providerId === "groq" ? DEFAULT_GROQ_PANEL_MODELS : DEFAULT_PANEL_MODELS;
    const fallbackModel =
      body.model ||
      (providerId === "groq"
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
        const stored = saveStoredRun(
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
                  const stored = saveStoredRun(
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
  const defaultProvider: StudioProviderId =
    process.env.MAI_DEFAULT_PROVIDER === "groq" && groqKey
      ? "groq"
      : nvidiaKey
        ? "nvidia"
        : groqKey
          ? "groq"
          : "nvidia";

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
    ready: nvidiaKey || groqKey,
    mode: nvidiaKey || groqKey ? "live" : "offline-echo",
    // Back-compat fields (NVIDIA-first)
    provider: defaultProvider === "groq" ? "Groq" : "NVIDIA NIM",
    defaultModel:
      defaultProvider === "groq"
        ? process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL
        : process.env.NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL,
    defaultPanelModels:
      defaultProvider === "groq"
        ? DEFAULT_GROQ_PANEL_MODELS
        : DEFAULT_PANEL_MODELS,
    models:
      defaultProvider === "groq" ? GROQ_CHAT_MODELS : NVIDIA_FREE_MODELS,
    baseUrl:
      defaultProvider === "groq"
        ? process.env.GROQ_BASE_URL || GROQ_BASE_URL
        : process.env.NVIDIA_BASE_URL ||
          "https://integrate.api.nvidia.com/v1",
    stream: true,
    hint:
      nvidiaKey || groqKey
        ? "POST { task, provider: 'nvidia'|'groq', expertModels, judgeModel, stream: true }"
        : "Set NVIDIA_API_KEY and/or GROQ_API_KEY, then restart pnpm web:dev.",
  });
}
