"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  SkipBack,
  SkipForward,
  Zap,
  ArrowRight,
  FlaskConical,
  FilePenLine,
  Gauge,
} from "lucide-react";
import {
  ExpertPanelFlow,
  idleMaiFlow,
  type FlowNodeState,
} from "./ExpertPanelFlow";
import { AgentModelPicker } from "./AgentModelPicker";
import { FinalAnswerCard } from "./FinalAnswerCard";
import {
  DEFAULT_PANEL_MODELS,
  NVIDIA_FREE_MODELS,
  PANEL_AGENT_ROLES,
  type NvidiaModelOption,
  type PanelAgentRole,
} from "@/lib/studio/nvidia-models";
import {
  DEFAULT_GROQ_PANEL_MODELS,
  GROQ_CHAT_MODELS,
} from "@/lib/studio/groq-models";
import {
  CASE_PRESETS,
  DEFAULT_CASE_PRESET_ID,
  getCasePreset,
  type CasePresetId,
} from "@/lib/studio/mai-case-presets";
import type { StudioProviderId } from "@/lib/studio/mai-panel-runner";

type ProviderInfo = {
  id: StudioProviderId;
  label: string;
  ready: boolean;
  defaultModel: string;
  defaultPanelModels: Record<string, string>;
  models: NvidiaModelOption[];
  baseUrl: string;
  costNote?: string;
};

type LiveStatus = {
  ready: boolean;
  mode: string;
  defaultModel: string;
  baseUrl: string;
  hint: string;
  defaultProvider?: StudioProviderId;
  providers?: {
    nvidia?: ProviderInfo;
    groq?: ProviderInfo;
  };
  models?: NvidiaModelOption[];
  defaultPanelModels?: Record<string, string>;
};

type ExpertResult = {
  name: string;
  model: string;
  role: string;
  output: string;
  success: boolean;
};

type LiveResult = {
  success: boolean;
  mode: "nvidia" | "groq" | "offline-echo";
  providerId?: string;
  task: string;
  provider: string;
  baseUrl: string;
  experts: ExpertResult[];
  judge: { name: string; model: string; output: string };
  finalAnswer: string;
  handoffs: Array<Record<string, unknown>>;
  timeline: Array<{
    id: string;
    label: string;
    kind: string;
    detail: string;
    model?: string;
  }>;
  safetyNote: string;
  durationMs: number;
  runId?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    currency: string;
    note: string;
  };
};

type StreamEvent =
  | {
      type: "run_start";
      mode: string;
      task: string;
      provider: string;
      model: string;
      experts: Array<{ name: string; model: string }>;
    }
  | { type: "node_start"; nodeId: string; label: string }
  | {
      type: "expert_done";
      expert: ExpertResult;
      index: number;
      total: number;
    }
  | { type: "handoff"; handoff: Record<string, unknown> }
  | { type: "judge_start"; model: string }
  | {
      type: "judge_done";
      judge: LiveResult["judge"];
      finalAnswer: string;
    }
  | { type: "run_complete"; result: LiveResult }
  | { type: "error"; message: string };

type LogLine = { t: string; text: string; kind: string };

type ReplayStep = {
  id: string;
  label: string;
  detail: string;
  kind: "user" | "expert" | "handoff" | "judge" | "final";
  expertName?: string;
  output?: string;
};

const DEFAULT_TASK = getCasePreset(DEFAULT_CASE_PRESET_ID).task;

const FALLBACK_MODELS: NvidiaModelOption[] = NVIDIA_FREE_MODELS;

const DEFAULT_AGENT_MODELS: Record<string, string> = {
  ...DEFAULT_PANEL_MODELS,
};

function modelsForProvider(
  provider: StudioProviderId,
  status: LiveStatus | null
): NvidiaModelOption[] {
  const fromApi = status?.providers?.[provider]?.models;
  if (fromApi && fromApi.length > 0) return fromApi;
  return provider === "groq" ? GROQ_CHAT_MODELS : NVIDIA_FREE_MODELS;
}

function defaultsForProvider(
  provider: StudioProviderId,
  status: LiveStatus | null
): Record<string, string> {
  const fromApi = status?.providers?.[provider]?.defaultPanelModels;
  if (fromApi) return { ...fromApi };
  return provider === "groq"
    ? { ...DEFAULT_GROQ_PANEL_MODELS }
    : { ...DEFAULT_PANEL_MODELS };
}

function nowTime() {
  const d = new Date();
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function logKind(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("error")) return "error";
  if (t.includes("handoff")) return "handoff";
  if (t.includes("complete") || t.includes("finished") || t.includes("unlocked"))
    return "complete";
  if (t.includes("done") || t.includes("success")) return "done";
  if (t.includes("start")) return "started";
  return "info";
}

function buildReplaySteps(result: LiveResult): ReplayStep[] {
  const steps: ReplayStep[] = [
    {
      id: "user",
      label: "User Query",
      kind: "user",
      detail: "Task intake",
      output: result.task,
    },
  ];
  for (const ex of result.experts) {
    steps.push({
      id: `expert-${ex.name}`,
      label: ex.name,
      kind: "expert",
      expertName: ex.name,
      detail: ex.success ? "Assessment complete" : "Failed",
      output: ex.output,
    });
  }
  for (const h of result.handoffs) {
    steps.push({
      id: `handoff-${String(h.from_agent)}`,
      label: `${String(h.from_agent)} → Judge`,
      kind: "handoff",
      expertName: String(h.from_agent),
      detail: "Structured HandoffState",
      output: String(h.summary || ""),
    });
  }
  steps.push({
    id: "judge",
    label: "Judge / Consensus",
    kind: "judge",
    detail: "Consensus synthesis",
    output: result.finalAnswer,
  });
  steps.push({
    id: "final",
    label: "Final Answer",
    kind: "final",
    detail: "Structured result",
    output: result.finalAnswer,
  });
  return steps;
}

function applyReplayFrame(result: LiveResult, stepIndex: number) {
  const steps = buildReplaySteps(result);
  const current = steps[Math.min(stepIndex, steps.length - 1)];

  const user: FlowNodeState = {
    id: "user",
    label: "User Query",
    sublabel: result.experts[0]?.model,
    status:
      stepIndex >= 0
        ? current?.id === "user"
          ? "running"
          : "done"
        : "idle",
    output: result.task,
  };

  const experts: FlowNodeState[] = result.experts.map((ex) => {
    const id = `expert-${ex.name}`;
    const idx = steps.findIndex((s) => s.id === id);
    let status: FlowNodeState["status"] = "idle";
    if (idx >= 0 && stepIndex >= idx) {
      status = current?.id === id ? "running" : ex.success ? "done" : "error";
    }
    return {
      id: ex.name,
      label: ex.name,
      sublabel: ex.model,
      status,
      output:
        status === "done" || status === "error" || status === "running"
          ? ex.output
          : undefined,
    };
  });

  const judgeIdx = steps.findIndex((s) => s.id === "judge");
  const finalIdx = steps.findIndex((s) => s.id === "final");

  let judgeStatus: FlowNodeState["status"] = "idle";
  if (judgeIdx >= 0 && stepIndex >= judgeIdx) {
    judgeStatus = current?.id === "judge" ? "running" : "done";
  }

  let finalStatus: FlowNodeState["status"] = "idle";
  if (finalIdx >= 0 && stepIndex >= finalIdx) {
    finalStatus = current?.id === "final" ? "running" : "done";
  }

  return {
    user,
    experts,
    judge: {
      id: "judge",
      label: "Judge / Consensus",
      sublabel: result.judge.model,
      status: judgeStatus,
      output:
        judgeStatus === "done" || judgeStatus === "running"
          ? result.finalAnswer
          : undefined,
    },
    finalNode: {
      id: "final",
      label: "Final Answer",
      sublabel: "Structured result",
      status: finalStatus,
      output: finalStatus === "done" ? result.finalAnswer : undefined,
    },
  };
}

export function MaiPanelLive() {
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [casePreset, setCasePreset] = useState<CasePresetId>(
    DEFAULT_CASE_PRESET_ID
  );
  const [task, setTask] = useState(DEFAULT_TASK);
  const [studioProvider, setStudioProvider] =
    useState<StudioProviderId>("nvidia");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LiveResult | null>(null);
  const [forceOffline, setForceOffline] = useState(false);
  const [activeMessage, setActiveMessage] = useState("");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [handoffs, setHandoffs] = useState<Array<Record<string, unknown>>>([]);
  const [copied, setCopied] = useState(false);
  const [replayMode, setReplayMode] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [agentModels, setAgentModels] =
    useState<Record<string, string>>(DEFAULT_AGENT_MODELS);
  const [modelCatalog, setModelCatalog] =
    useState<NvidiaModelOption[]>(FALLBACK_MODELS);
  const replayTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const initialFlow = useMemo(
    () =>
      idleMaiFlow(
        status?.defaultModel || DEFAULT_AGENT_MODELS["Expert A"],
        agentModels
      ),
    // Initial mount only — agentModels updates applied via reset/run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status?.defaultModel]
  );
  const [user, setUser] = useState<FlowNodeState>(initialFlow.user);
  const [experts, setExperts] = useState<FlowNodeState[]>(initialFlow.experts);
  const [judge, setJudge] = useState<FlowNodeState>(initialFlow.judge);
  const [finalNode, setFinalNode] = useState<FlowNodeState>(
    initialFlow.finalNode
  );

  const replaySteps = useMemo(
    () => (result ? buildReplaySteps(result) : []),
    [result]
  );

  const pushLog = useCallback((text: string) => {
    setLogs((prev) => [
      ...prev.slice(-60),
      { t: nowTime(), text, kind: logKind(text) },
    ]);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [logs]);

  const stopReplayTimer = useCallback(() => {
    if (replayTimer.current) {
      clearInterval(replayTimer.current);
      replayTimer.current = null;
    }
    setReplayPlaying(false);
  }, []);

  const applyReplay = useCallback((index: number, res: LiveResult) => {
    const frame = applyReplayFrame(res, index);
    setUser(frame.user);
    setExperts(frame.experts);
    setJudge(frame.judge);
    setFinalNode(frame.finalNode);
    setReplayIndex(index);
  }, []);

  const resetFlow = useCallback(() => {
    stopReplayTimer();
    setReplayMode(false);
    setReplayIndex(0);
    const idle = idleMaiFlow(status?.defaultModel, agentModels);
    setUser(idle.user);
    setExperts(idle.experts);
    setJudge(idle.judge);
    setFinalNode(idle.finalNode);
    setHandoffs([]);
    setResult(null);
    setError(null);
    setActiveMessage("");
    setLogs([]);
  }, [status?.defaultModel, agentModels, stopReplayTimer]);

  useEffect(() => () => stopReplayTimer(), [stopReplayTimer]);

  useEffect(() => {
    if (!replayPlaying || !result) return;
    replayTimer.current = setInterval(() => {
      setReplayIndex((i) => {
        const steps = buildReplaySteps(result);
        if (i >= steps.length - 1) {
          stopReplayTimer();
          return i;
        }
        const next = i + 1;
        applyReplay(next, result);
        setActiveMessage(`Replay · ${steps[next]?.label ?? next + 1}`);
        return next;
      });
    }, 1300);
    return () => {
      if (replayTimer.current) clearInterval(replayTimer.current);
    };
  }, [replayPlaying, result, applyReplay, stopReplayTimer]);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/demos/mai-panel");
      const data = (await res.json()) as LiveStatus;
      const preferred =
        data.defaultProvider === "groq" || data.defaultProvider === "nvidia"
          ? data.defaultProvider
          : studioProvider;
      setStatus({
        ready: Boolean(data.ready),
        mode: data.mode,
        defaultModel: data.defaultModel,
        baseUrl: data.baseUrl,
        hint: data.hint,
        defaultProvider: data.defaultProvider,
        providers: data.providers,
        models: data.models,
        defaultPanelModels: data.defaultPanelModels,
      });
      setStudioProvider((prev) => {
        // Keep user choice if that provider is ready; else fall back.
        const keep =
          (prev === "groq" && data.providers?.groq?.ready) ||
          (prev === "nvidia" && data.providers?.nvidia?.ready);
        return keep ? prev : preferred;
      });
      const active =
        (studioProvider === "groq" && data.providers?.groq?.ready) ||
        (studioProvider === "nvidia" && data.providers?.nvidia?.ready)
          ? studioProvider
          : preferred;
      const catalog = modelsForProvider(active, data);
      setModelCatalog(catalog);
      const defs = defaultsForProvider(active, data);
      setAgentModels((prev) => {
        // Only seed defaults if current models aren't in the active catalog
        const ids = new Set(catalog.map((m) => m.id));
        const needsReset = !Object.values(prev).every((id) => ids.has(id));
        return needsReset ? { ...defs } : prev;
      });
    } catch (err) {
      setStatus({
        ready: false,
        mode: "unknown",
        defaultModel: "z-ai/glm-5.2",
        baseUrl: "https://integrate.api.nvidia.com/v1",
        hint: err instanceof Error ? err.message : "Status check failed",
      });
    }
  }, [studioProvider]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      switch (event.type) {
        case "run_start":
          pushLog(`Run started · ${event.mode} · ${event.provider}`);
          setActiveMessage("Receiving task…");
          setUser((u) => ({ ...u, status: "running", output: event.task }));
          setExperts(
            event.experts.map((e) => ({
              id: e.name,
              label: e.name,
              sublabel: e.model,
              status: "pending" as const,
            }))
          );
          setJudge((j) => ({
            ...j,
            status: "idle",
            output: undefined,
            sublabel: event.model,
          }));
          setFinalNode((f) => ({ ...f, status: "idle", output: undefined }));
          break;
        case "node_start":
          if (event.nodeId === "user") {
            setUser((u) => ({ ...u, status: "done" }));
            setActiveMessage("Dispatching to expert panel…");
            pushLog("User query accepted");
          } else if (event.nodeId === "judge") {
            setJudge((j) => ({ ...j, status: "running" }));
            setActiveMessage("Judge synthesizing consensus…");
            pushLog("Judge started");
          } else if (event.nodeId === "final") {
            setFinalNode((f) => ({ ...f, status: "running" }));
          } else {
            setExperts((list) =>
              list.map((n) =>
                n.id === event.nodeId || n.label === event.label
                  ? { ...n, status: "running" }
                  : n
              )
            );
            setActiveMessage(`${event.label} thinking…`);
            pushLog(`${event.label} started`);
          }
          break;
        case "expert_done":
          setExperts((list) =>
            list.map((n) =>
              n.id === event.expert.name || n.label === event.expert.name
                ? {
                    ...n,
                    status: event.expert.success ? "done" : "error",
                    sublabel: event.expert.model,
                    output: event.expert.output,
                  }
                : n
            )
          );
          pushLog(
            `${event.expert.name} ${event.expert.success ? "done" : "failed"} (${event.index + 1}/${event.total})`
          );
          setActiveMessage(`Experts ${event.index + 1}/${event.total} complete…`);
          break;
        case "handoff":
          setHandoffs((h) => [...h, event.handoff]);
          pushLog(
            `Handoff ${String(event.handoff.from_agent)} → ${String(event.handoff.to_agent)}`
          );
          break;
        case "judge_start":
          setJudge((j) => ({ ...j, status: "running", sublabel: event.model }));
          setActiveMessage("Judge / Consensus running…");
          break;
        case "judge_done":
          setJudge((j) => ({
            ...j,
            status: event.finalAnswer.startsWith("ERROR:") ? "error" : "done",
            sublabel: event.judge.model,
            output: event.finalAnswer,
          }));
          setFinalNode((f) => ({
            ...f,
            status: event.finalAnswer.startsWith("ERROR:") ? "error" : "done",
            output: event.finalAnswer,
          }));
          pushLog("Judge finished · final answer ready");
          setActiveMessage("Finalizing…");
          break;
        case "run_complete": {
          const res = {
            ...event.result,
            runId: `run_${Date.now().toString(36)}`,
          };
          setResult(res);
          setRunning(false);
          pushLog(
            `Complete · ${res.success ? "success" : "errors"} · ${(res.durationMs / 1000).toFixed(1)}s`
          );
          const last = buildReplaySteps(res).length - 1;
          const frame = applyReplayFrame(res, last);
          setUser(frame.user);
          setExperts(frame.experts);
          setJudge(frame.judge);
          setFinalNode(frame.finalNode);
          setReplayMode(true);
          setReplayIndex(last);
          setActiveMessage("Run finished · final answer ready");
          pushLog("Replay unlocked — scrub steps below");
          // Reveal final answer card smoothly after paint
          requestAnimationFrame(() => {
            document
              .getElementById("final-answer")
              ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          });
          break;
        }
        case "error":
          setError(event.message);
          setRunning(false);
          setActiveMessage("");
          pushLog(`Error: ${event.message}`);
          break;
      }
    },
    [pushLog]
  );

  const run = async () => {
    stopReplayTimer();
    setReplayMode(false);
    setRunning(true);
    setError(null);
    setResult(null);
    setHandoffs([]);
    setLogs([]);
    const idle = idleMaiFlow(status?.defaultModel, agentModels);
    setUser({ ...idle.user, status: "pending" });
    setExperts(idle.experts.map((e) => ({ ...e, status: "pending" })));
    setJudge({ ...idle.judge, status: "idle", output: undefined });
    setFinalNode({ ...idle.finalNode, status: "idle", output: undefined });
    setActiveMessage(
      `Starting ${studioProvider === "groq" ? "Groq" : "NVIDIA NIM"} panel…`
    );
    pushLog(
      `Provider · ${studioProvider} · A=${agentModels["Expert A"]} · B=${agentModels["Expert B"]} · C=${agentModels["Expert C"]} · Judge=${agentModels.Judge}`
    );
    pushLog("Streaming from /api/demos/mai-panel…");

    try {
      const res = await fetch("/api/demos/mai-panel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task,
          provider: studioProvider,
          offline: forceOffline,
          stream: true,
          casePreset,
          expertModels: {
            "Expert A": agentModels["Expert A"],
            "Expert B": agentModels["Expert B"],
            "Expert C": agentModels["Expert C"],
          },
          judgeModel: agentModels.Judge,
          model: agentModels.Judge || status?.defaultModel,
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error((await res.text()) || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            handleEvent(JSON.parse(trimmed) as StreamEvent);
          } catch {
            pushLog(`Bad chunk: ${trimmed.slice(0, 60)}`);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setActiveMessage("");
    } finally {
      setRunning(false);
      void refreshStatus();
    }
  };

  const codeJson = useMemo(() => {
    if (!result) return "";
    return JSON.stringify(
      {
        demo: "mai-style-panel",
        mode: result.mode,
        provider_id: result.providerId,
        provider: result.provider,
        task: result.task,
        experts: result.experts.map((e) => ({
          name: e.name,
          model: e.model,
          success: e.success,
          output: e.output,
        })),
        handoffs: result.handoffs,
        judge: result.judge,
        final_answer: result.finalAnswer,
        duration_ms: result.durationMs,
        usage: result.usage,
        safety_note: result.safetyNote,
      },
      null,
      2
    );
  }, [result]);

  const copyCode = async () => {
    if (!codeJson) return;
    try {
      await navigator.clipboard.writeText(codeJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  const currentReplay = replaySteps[replayIndex];
  const modelsUsed = result
    ? [
        ...new Set([
          ...result.experts.map((e) => e.model),
          result.judge.model,
        ]),
      ]
    : [];

  return (
    <section id="live-run" className="mai-dash px-4 py-8 sm:px-6 sm:py-10">
      <div className="mai-dash-shell mx-auto max-w-[1400px]">
        {/* 1. Header */}
        <header className="mai-dash-header">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-3xl">
              <div className="mai-badge-live">
                <span className="mai-pulse-dot" />
                LIVE RUN · HANDOFF KIT + NVIDIA NIM
              </div>
              <h1 className="mai-dash-title">MAI-style expert panel</h1>
              <p className="mai-dash-sub">
                Run live, watch the graph update, then replay every step with
                summary and structured JSON.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {status?.ready && !forceOffline ? (
                  <span className="mai-chip mai-chip-success">
                    <Zap size={12} />
                    {studioProvider === "groq" ? "Groq ready" : "NVIDIA ready"}
                  </span>
                ) : (
                  <span className="mai-chip mai-chip-warn">
                    <AlertCircle size={12} />
                    Offline Echo
                  </span>
                )}
                <span className="mai-chip" title="Active provider">
                  {studioProvider === "groq" ? "groq" : "nvidia-nim"}
                </span>
                <span className="mai-chip" title="Per-agent models">
                  multi-model ·{" "}
                  {agentModels["Expert A"]?.split("/").pop() ?? "model"}
                </span>
                {replayMode && result && (
                  <span className="mai-chip mai-chip-accent">Replay ready</span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={() => resetFlow()}
                disabled={running}
                className="mai-btn-ghost"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => void refreshStatus()}
                className="mai-btn-ghost"
              >
                <RefreshCw size={14} />
                Status
              </button>
            </div>
          </div>
        </header>

        {/* 2. Control */}
        <div className="mai-grid-control">
          <div className="mai-module">
            <div className="mai-case-block">
              <div className="mai-case-block-head">
                <div>
                  <label className="mai-label" htmlFor="mai-task">
                    Case library
                  </label>
                  <p className="mai-case-lead">
                    Pick a preset vignette or write your own. Benchmark gives
                    the panel more signal for calibrated top-3 weights.
                  </p>
                </div>
                <span className="mai-case-active-pill">
                  {CASE_PRESETS.find((p) => p.id === casePreset)?.label ??
                    "Custom"}
                </span>
              </div>

              <div
                className="mai-case-presets"
                role="radiogroup"
                aria-label="Case presets"
              >
                {CASE_PRESETS.map((preset) => {
                  const active = casePreset === preset.id;
                  const Icon =
                    preset.id === "benchmark"
                      ? FlaskConical
                      : preset.id === "simple"
                        ? Gauge
                        : FilePenLine;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={running}
                      className={`mai-case-card mai-case-card-${preset.id}${
                        active ? " is-active" : ""
                      }`}
                      onClick={() => {
                        setCasePreset(preset.id);
                        setTask(preset.task);
                      }}
                    >
                      <div className="mai-case-card-top">
                        <span className="mai-case-card-icon" aria-hidden>
                          <Icon size={16} strokeWidth={2.2} />
                        </span>
                        <span className="mai-case-card-tag">{preset.tag}</span>
                      </div>
                      <span className="mai-case-card-label">{preset.label}</span>
                      <span className="mai-case-card-blurb">{preset.blurb}</span>
                      <span className="mai-case-card-meta">{preset.meta}</span>
                      {active && (
                        <span className="mai-case-card-check" aria-hidden>
                          <Check size={12} strokeWidth={2.6} />
                          Selected
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <label className="mai-label mai-case-editor-label" htmlFor="mai-task">
                Case editor
              </label>
              <textarea
                id="mai-task"
                value={task}
                onChange={(e) => {
                  setTask(e.target.value);
                  setCasePreset("blank");
                }}
                rows={casePreset === "benchmark" ? 12 : 8}
                disabled={running}
                className="mai-textarea mai-case-textarea"
              />
              <label className="mai-check">
                <input
                  type="checkbox"
                  checked={forceOffline}
                  disabled={running}
                  onChange={(e) => setForceOffline(e.target.checked)}
                />
                Force offline EchoProvider
              </label>
            </div>
          </div>
          <div className="mai-module mai-quick">
            <p className="mai-label">Quick actions</p>
            <p className="mt-1 text-[0.8rem] leading-relaxed text-[var(--navy-muted)]">
              Stream experts in parallel, then judge consensus. Replay unlocks
              when the run finishes.
            </p>
            <button
              type="button"
              onClick={() => void run()}
              disabled={running}
              className="mai-btn-primary mt-5 w-full"
            >
              {running ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Running panel…
                </>
              ) : (
                <>
                  <Play size={16} fill="currentColor" />
                  Run live panel
                </>
              )}
            </button>
          </div>
        </div>

        {/* Models per agent */}
        <div className="mai-module mai-models-module">
          <div className="mai-models-head">
            <div>
              <p className="mai-label">Provider & models</p>
              <p className="mai-models-lead">
                Switch between <strong>NVIDIA NIM</strong> (free trial) and{" "}
                <strong>Groq</strong> (billable, public $/M rates). Then pick a
                model per expert and judge.
              </p>
            </div>
            <a
              href={
                studioProvider === "groq"
                  ? "https://console.groq.com/docs/models"
                  : "https://build.nvidia.com/models"
              }
              target="_blank"
              rel="noreferrer"
              className="mai-models-catalog-link"
            >
              {studioProvider === "groq" ? "Groq models" : "NIM catalog"}
              <ArrowRight size={13} strokeWidth={2.2} />
            </a>
          </div>

          <div className="mai-provider-switch" role="radiogroup" aria-label="LLM provider">
            {(
              [
                {
                  id: "nvidia" as const,
                  label: "NVIDIA NIM",
                  blurb: "Free trial endpoints",
                  ready: Boolean(status?.providers?.nvidia?.ready ?? status?.ready),
                },
                {
                  id: "groq" as const,
                  label: "Groq",
                  blurb: "On-demand · metered",
                  ready: Boolean(status?.providers?.groq?.ready),
                },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={studioProvider === p.id}
                disabled={running || (!p.ready && p.id === "groq")}
                className={`mai-provider-card${
                  studioProvider === p.id ? " is-active" : ""
                }${!p.ready ? " is-off" : ""}`}
                onClick={() => {
                  setStudioProvider(p.id);
                  const catalog = modelsForProvider(p.id, status);
                  setModelCatalog(catalog);
                  setAgentModels(defaultsForProvider(p.id, status));
                }}
              >
                <span className="mai-provider-card-label">{p.label}</span>
                <span className="mai-provider-card-blurb">{p.blurb}</span>
                <span
                  className={`mai-provider-card-ready${
                    p.ready ? " is-on" : ""
                  }`}
                >
                  {p.ready ? "API key ready" : "No key"}
                </span>
              </button>
            ))}
          </div>

          <div className="mai-model-grid">
            {PANEL_AGENT_ROLES.map((role: PanelAgentRole) => {
              const selected =
                agentModels[role] || DEFAULT_AGENT_MODELS[role] || "";
              return (
                <AgentModelPicker
                  key={role}
                  role={role}
                  value={selected}
                  models={modelCatalog}
                  disabled={running}
                  onChange={(id) => {
                    setAgentModels((prev) => ({ ...prev, [role]: id }));
                    if (role === "Judge") {
                      setJudge((j) => ({ ...j, sublabel: id }));
                    } else {
                      setExperts((list) =>
                        list.map((n) =>
                          n.id === role || n.label === role
                            ? { ...n, sublabel: id }
                            : n
                        )
                      );
                    }
                  }}
                />
              );
            })}
          </div>
        </div>

        {error && (
          <div className="mai-error">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {/* 3 + 4. Flow + Log */}
        <div className="mai-grid-main">
          <div className="mai-module mai-module-flow">
            <ExpertPanelFlow
              user={user}
              experts={experts}
              judge={judge}
              finalNode={finalNode}
              activeMessage={activeMessage}
            />
          </div>

          <div className="flex flex-col gap-4">
            <div className="mai-module flex min-h-[280px] flex-1 flex-col">
              <p className="mai-label">Execution log</p>
              <div className="mai-log mt-3 flex-1">
                {logs.length === 0 ? (
                  <p className="px-1 py-6 text-center text-[0.8rem] text-[#94a3b8]">
                    Waiting for run…
                  </p>
                ) : (
                  logs.map((line, i) => (
                    <div key={`${line.t}-${i}`} className="mai-log-row">
                      <span className="mai-log-time">{line.t}</span>
                      <span className={`mai-log-kind mai-log-kind-${line.kind}`}>
                        {line.kind}
                      </span>
                      <span className="mai-log-text">{line.text}</span>
                    </div>
                  ))
                )}
                <div ref={logEndRef} />
              </div>
            </div>

            {/* 5. Replay */}
            {result && replaySteps.length > 0 && (
              <div id="replay-panel" className="mai-module">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="mai-label">Replay</p>
                    <p className="text-sm font-semibold text-[var(--navy)]">
                      Step through this run
                    </p>
                  </div>
                  <span className="font-mono text-xs tabular-nums text-[var(--navy-muted)]">
                    {replayIndex + 1} / {replaySteps.length}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="mai-icon-btn"
                    aria-label="Previous"
                    onClick={() => {
                      stopReplayTimer();
                      if (!result) return;
                      const i = Math.max(0, replayIndex - 1);
                      applyReplay(i, result);
                      setActiveMessage(`Replay · ${replaySteps[i]?.label}`);
                    }}
                  >
                    <SkipBack size={15} />
                  </button>
                  <button
                    type="button"
                    className="mai-play-btn"
                    aria-label={replayPlaying ? "Pause" : "Play"}
                    onClick={() => {
                      if (replayPlaying) stopReplayTimer();
                      else {
                        setReplayMode(true);
                        setReplayPlaying(true);
                      }
                    }}
                  >
                    {replayPlaying ? (
                      <Pause size={15} fill="currentColor" />
                    ) : (
                      <Play size={15} fill="currentColor" className="ml-0.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="mai-icon-btn"
                    aria-label="Next"
                    onClick={() => {
                      stopReplayTimer();
                      if (!result) return;
                      const i = Math.min(
                        replaySteps.length - 1,
                        replayIndex + 1
                      );
                      applyReplay(i, result);
                      setActiveMessage(`Replay · ${replaySteps[i]?.label}`);
                    }}
                  >
                    <SkipForward size={15} />
                  </button>
                </div>

                <div className="mai-timeline mt-4">
                  {replaySteps.map((s, i) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        stopReplayTimer();
                        if (!result) return;
                        applyReplay(i, result);
                        setActiveMessage(`Replay · ${s.label}`);
                      }}
                      className={`mai-timeline-chip ${
                        i === replayIndex
                          ? "mai-timeline-chip-active"
                          : i < replayIndex
                            ? "mai-timeline-chip-past"
                            : ""
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                {currentReplay && (
                  <div className="mai-replay-body mt-4">
                    <p className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-[var(--blue)]">
                      {currentReplay.kind}
                    </p>
                    <p className="mt-1 text-[0.95rem] font-semibold text-[var(--navy)]">
                      {currentReplay.label}
                    </p>
                    <p className="mt-0.5 text-[0.8rem] text-[var(--navy-muted)]">
                      {currentReplay.detail}
                    </p>
                    {currentReplay.output && (
                      <p className="mt-3 max-h-36 overflow-y-auto whitespace-pre-wrap text-[0.8rem] leading-relaxed text-[#475569]">
                        {currentReplay.output}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Final answer — dedicated showcase */}
        {result && (
          <FinalAnswerCard
            answer={result.finalAnswer}
            model={result.judge.model}
            durationMs={result.durationMs}
            success={result.success}
            safetyNote={result.safetyNote}
            runId={result.runId}
          />
        )}

        {/* 6 + 7. Summary + JSON */}
        {result && (
          <div className="mai-grid-bottom">
            <div className="mai-module mai-report">
              <div className="mai-report-head">
                <div>
                  <p className="mai-label">Run summary</p>
                  <p className="mai-report-title">Live execution report</p>
                  <p className="mai-report-sub">
                    Topology · models · handoffs · cost path for this run
                  </p>
                </div>
                {result.success ? (
                  <span className="mai-chip mai-chip-success">
                    <CheckCircle2 size={13} />
                    Success
                  </span>
                ) : (
                  <span className="mai-chip mai-chip-warn">
                    <AlertCircle size={13} />
                    Partial / errors
                  </span>
                )}
              </div>

              <div className="mai-report-case">
                <span className="mai-report-case-kicker">Case</span>
                <p className="mai-report-case-text">
                  {result.task.length > 220
                    ? `${result.task.slice(0, 220).trim()}…`
                    : result.task}
                </p>
              </div>

              <div className="mai-report-stats">
                <div className="mai-report-stat">
                  <span className="mai-report-stat-label">Duration</span>
                  <span className="mai-report-stat-value">
                    {(result.durationMs / 1000).toFixed(1)}s
                  </span>
                </div>
                <div className="mai-report-stat">
                  <span className="mai-report-stat-label">Experts</span>
                  <span className="mai-report-stat-value">
                    {result.experts.filter((e) => e.success).length}/
                    {result.experts.length}
                  </span>
                </div>
                <div className="mai-report-stat">
                  <span className="mai-report-stat-label">Handoffs</span>
                  <span className="mai-report-stat-value">
                    {result.handoffs.length}
                  </span>
                </div>
                <div className="mai-report-stat">
                  <span className="mai-report-stat-label">Live cost</span>
                  <span
                    className={`mai-report-stat-value${
                      result.mode === "nvidia" || result.mode === "offline-echo"
                        ? " mai-report-stat-free"
                        : ""
                    }`}
                  >
                    {result.mode === "offline-echo"
                      ? "Echo"
                      : result.mode === "nvidia"
                        ? "$0.00"
                        : `$${(result.usage?.costUsd ?? 0).toFixed(4)}`}
                  </span>
                </div>
              </div>

              {result.usage && result.usage.totalTokens > 0 && (
                <p className="mai-report-usage">
                  Tokens · in {result.usage.promptTokens.toLocaleString()} · out{" "}
                  {result.usage.completionTokens.toLocaleString()} · total{" "}
                  {result.usage.totalTokens.toLocaleString()}
                  {result.mode === "groq"
                    ? ` · est. $${result.usage.costUsd.toFixed(4)}`
                    : ""}
                  <br />
                  <span className="text-[#94a3b8]">{result.usage.note}</span>
                </p>
              )}

              <dl className="mai-summary-table">
                <SummaryRow label="Run ID" value={result.runId || "—"} mono />
                <SummaryRow
                  label="Mode"
                  value={
                    result.mode === "nvidia"
                      ? "NVIDIA NIM (live)"
                      : result.mode === "groq"
                        ? "Groq (live)"
                        : "Offline Echo"
                  }
                />
                <SummaryRow label="Provider" value={result.provider} />
                <SummaryRow
                  label="Judge"
                  value={
                    <span className="font-mono text-[0.72rem]">
                      {result.judge.model}
                    </span>
                  }
                />
                <SummaryRow
                  label="Models"
                  value={
                    <span className="flex flex-wrap justify-end gap-1">
                      {modelsUsed.map((m) => (
                        <span key={m} className="mai-model-tag">
                          {m.split("/").pop() || m}
                        </span>
                      ))}
                    </span>
                  }
                />
                <SummaryRow
                  label="Final answer"
                  value={
                    <a href="#final-answer" className="mai-summary-link">
                      View full answer ↑
                    </a>
                  }
                />
              </dl>

              <div className="mai-report-experts">
                <p className="mai-report-experts-label">Expert outcomes</p>
                <ul>
                  {result.experts.map((ex) => (
                    <li key={ex.name}>
                      <span
                        className={`mai-report-dot${
                          ex.success ? " is-ok" : " is-bad"
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="mai-report-ex-name">{ex.name}</p>
                        <p className="mai-report-ex-model" title={ex.model}>
                          {ex.model}
                        </p>
                      </div>
                      <span
                        className={`mai-report-ex-status${
                          ex.success ? " is-ok" : " is-bad"
                        }`}
                      >
                        {ex.success ? "ok" : "fail"}
                      </span>
                    </li>
                  ))}
                  <li>
                    <span
                      className={`mai-report-dot${
                        result.finalAnswer.startsWith("ERROR:")
                          ? " is-bad"
                          : " is-ok"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="mai-report-ex-name">Judge</p>
                      <p className="mai-report-ex-model" title={result.judge.model}>
                        {result.judge.model}
                      </p>
                    </div>
                    <span
                      className={`mai-report-ex-status${
                        result.finalAnswer.startsWith("ERROR:")
                          ? " is-bad"
                          : " is-ok"
                      }`}
                    >
                      {result.finalAnswer.startsWith("ERROR:") ? "fail" : "ok"}
                    </span>
                  </li>
                </ul>
              </div>

              <p className="mai-report-note">
                Live Studio path uses NVIDIA NIM free trial endpoints when a key
                is configured ($0). Commercial estimates use public Groq $/M
                rates when comparing the same topology.
              </p>
            </div>

            <div className="mai-module">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="mai-label">Structured output</p>
                  <p className="text-base font-semibold text-[var(--navy)]">
                    Run JSON
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void copyCode()}
                  className="mai-btn-ghost !px-3 !py-1.5 !text-xs"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="mai-code">
                <div className="mai-code-bar">
                  <span className="mai-code-dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="mai-code-name">mai_panel_result.json</span>
                </div>
                <pre>
                  <code>{codeJson}</code>
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* Run history (for future benchmarks) */}
        <RunHistoryPanel refreshKey={result?.runId || ""} />

        {/* 8. Handoffs */}
        {result && (handoffs.length > 0 || result.handoffs.length > 0) && (
          <div>
            <div className="mb-3 flex items-end justify-between gap-2">
              <div>
                <p className="mai-label">Structured handoffs</p>
                <p className="text-base font-semibold text-[var(--navy)]">
                  Evidence trail (
                  {handoffs.length || result.handoffs.length})
                </p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {(handoffs.length ? handoffs : result.handoffs).map((h, i) => (
                <article key={i} className="mai-handoff-card">
                  <div className="flex items-center gap-1.5 text-[0.8rem] font-semibold text-[var(--navy)]">
                    <span className="text-[var(--blue)]">
                      {String(h.from_agent)}
                    </span>
                    <ArrowRight size={13} className="text-[#94a3b8]" />
                    <span>{String(h.to_agent)}</span>
                  </div>
                  <span className="mai-handoff-type">HandoffState · hybrid</span>
                  <p className="mt-2 line-clamp-5 text-[0.78rem] leading-relaxed text-[#64748b]">
                    {String(h.summary || "")}
                  </p>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

type HistoryRow = {
  id: string;
  createdAt: string;
  providerId: string;
  success: boolean;
  durationMs: number;
  judgeModel: string;
  taskPreview: string;
  rankingLabels: string[];
  costUsd?: number;
  benchmarkReady: boolean;
};

function RunHistoryPanel({ refreshKey }: { refreshKey: string }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/demos/mai-panel/runs?limit=30");
      const data = (await res.json()) as {
        ok?: boolean;
        runs?: HistoryRow[];
        error?: string;
      };
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setRows(Array.isArray(data.runs) ? data.runs : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <div id="run-history" className="mai-module mai-history">
      <div className="mai-history-head">
        <div>
          <p className="mai-label">Run history</p>
          <p className="text-base font-semibold text-[var(--navy)]">
            Local studio log
          </p>
          <p className="mt-1 text-[0.78rem] text-[var(--navy-muted)]">
            Saved after each live panel. When volume grows, export a benchmark
            corpus from{" "}
            <code className="text-[0.72rem]">/api/demos/mai-panel/runs?export=benchmark</code>
            .
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="mai-btn-ghost !px-3 !py-1.5 !text-xs"
            onClick={() => void load()}
          >
            <RefreshCw size={13} />
            Refresh
          </button>
          <a
            href="/api/demos/mai-panel/runs?export=benchmark"
            className="mai-btn-ghost !px-3 !py-1.5 !text-xs"
            target="_blank"
            rel="noreferrer"
          >
            Export benchmark
          </a>
        </div>
      </div>

      {loading && (
        <p className="text-[0.8rem] text-[var(--navy-muted)]">Loading…</p>
      )}
      {error && (
        <p className="text-[0.8rem] text-[#b91c1c]">{error}</p>
      )}
      {!loading && !error && rows.length === 0 && (
        <p className="text-[0.8rem] text-[var(--navy-muted)]">
          No runs yet. Run the live panel once to seed history.
        </p>
      )}
      {!loading && rows.length > 0 && (
        <ul className="mai-history-list">
          {rows.map((r) => (
            <li key={r.id} className="mai-history-row">
              <div className="mai-history-row-top">
                <span className="mai-history-id" title={r.id}>
                  {r.id}
                </span>
                <span
                  className={`mai-history-badge${
                    r.success ? " is-ok" : " is-bad"
                  }`}
                >
                  {r.success ? "ok" : "fail"}
                </span>
                {r.benchmarkReady && (
                  <span className="mai-history-badge is-bench">benchmark</span>
                )}
              </div>
              <p className="mai-history-task">{r.taskPreview}…</p>
              <div className="mai-history-meta">
                <span>{r.providerId}</span>
                <span>{(r.durationMs / 1000).toFixed(1)}s</span>
                <span className="font-mono">{r.judgeModel.split("/").pop()}</span>
                {typeof r.costUsd === "number" && r.costUsd > 0 && (
                  <span>${r.costUsd.toFixed(4)}</span>
                )}
                <span className="mai-history-time">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>
              {r.rankingLabels.length > 0 && (
                <p className="mai-history-ranks">
                  {r.rankingLabels.slice(0, 3).join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="mai-summary-row">
      <dt>{label}</dt>
      <dd className={mono ? "font-mono text-[0.75rem]" : ""}>{value}</dd>
    </div>
  );
}
