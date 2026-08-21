/**
 * Mock data for Handoff Kit Studio /demos.
 * Easy to edit / later replace with API responses.
 * Not real production metrics.
 */

export type DemoCategory =
  | "All Demos"
  | "Clinical"
  | "Coding"
  | "Eval"
  | "Research"
  | "Support";

export type DemoTag = {
  label: string;
  tone: "blue" | "green" | "purple" | "orange" | "cyan";
};

export type WorkflowNode = {
  id: string;
  label: string;
  sublabel?: string;
  tone?: "blue" | "green" | "purple" | "orange" | "cyan" | "navy";
};

export type WorkflowStage = {
  id: string;
  nodes: WorkflowNode[];
};

export type TimelineEvent = {
  id: string;
  label: string;
  kind: "user" | "expert" | "judge" | "system" | "complete" | "agent";
  time: string;
  detail?: string;
  /** Optional model / role chip on timeline rows */
  model?: string;
  /** Optional duration of this segment, e.g. "18s" */
  duration?: string;
};

/** Discrete orchestration steps (Steps mode) — not the same as timed timeline */
export type FlowStep = {
  id: string;
  label: string;
  kind: TimelineEvent["kind"];
  title: string;
  detail: string;
  model?: string;
  /** Stage group for workflow highlight */
  stageId: string;
};

export type RunCostLine = {
  role: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: string;
  rateNote: string;
};

export type RunSummary = {
  status: "Success" | "Failed" | "Running";
  runId: string;
  started: string;
  duration: string;
  models: string[];
  handoffs: number;
  tokens: number;
  /** Pre-formatted for SSR-safe display (avoid locale mismatch) */
  tokensLabel: string;
  /** Primary cost shown (usually live path) */
  cost: string;
  /** Optional: commercial comparison with public rates */
  costCompare?: {
    label: string;
    amount: string;
    source: string;
    sourceUrl: string;
  };
  costBreakdown?: RunCostLine[];
  costNote?: string;
  caseLabel?: string;
};

export type HandoffStep = {
  from: string;
  to: string;
  summary: string;
};

export type DemoDetail = {
  longDescription: string;
  highlights: string[];
  workflow: { title: string; stages: WorkflowStage[] };
  /** Ordered orchestration steps for Steps mode */
  flowSteps?: FlowStep[];
  timeline: TimelineEvent[];
  runSummary: RunSummary;
  handoffs: HandoffStep[];
  sampleOutput: string;
  player: {
    speed: string;
    current: string;
    total: string;
  };
};

export type DemoItem = {
  id: string;
  title: string;
  description: string;
  category: Exclude<DemoCategory, "All Demos">;
  tags: DemoTag[];
  featured?: boolean;
  accent: "blue" | "green" | "purple" | "orange";
  workflowKind: "panel" | "coding" | "rescue" | "support";
  metrics: {
    successRate: string;
    avgHandoffs: string;
    avgLatency: string;
    totalRuns: string;
  };
  detail: DemoDetail;
};

/** Locale-stable number formatting for SSR/client match */
export function formatInt(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Hero stat tiles — mock / editable only */
export const heroStats = [
  { label: "Demos", value: "120+", hint: "catalog size (mock)" },
  { label: "Runs", value: "2,456", hint: "sample aggregate (mock)" },
  { label: "Success Rate", value: "98.6%", hint: "sample aggregate (mock)" },
  { label: "Handoffs", value: "14.2k", hint: "sample aggregate (mock)" },
] as const;

export const demoCategories: DemoCategory[] = [
  "All Demos",
  "Clinical",
  "Coding",
  "Eval",
  "Research",
  "Support",
];

export const demos: DemoItem[] = [
  {
    id: "mai-style-panel",
    title: "MAI-style Expert Panel",
    description:
      "Three experts + a judge debate a real post-flight winter URI vignette on free NVIDIA NIM models, then ship calibrated top-3 weights with an auditable handoff trail.",
    category: "Clinical",
    tags: [
      { label: "Clinical", tone: "cyan" },
      { label: "Multi-Agent", tone: "blue" },
      { label: "Consensus", tone: "purple" },
    ],
    featured: true,
    accent: "blue",
    workflowKind: "panel",
    metrics: {
      successRate: "Sample",
      avgHandoffs: "3–4",
      avgLatency: "~5–120s",
      totalRuns: "Studio live",
    },
    detail: {
      longDescription:
        "Research-only panel on a dense 41-year-old post-flight mid-winter case (timeline, SpO2, vaccines, explicit negatives). Expert A ranks, Expert B red-teams, Expert C stewards evidence; the Judge returns top-3 possibilities with percentages. Live path runs on NVIDIA NIM free endpoints ($0); commercial equivalent priced via public Groq rates.",
      highlights: [
        "Benchmark case with day-by-day timeline",
        "Parallel experts on distinct NIM models",
        "Judge top-3 + % + red-flag re-rank",
        "Live cost $0 · Groq equiv. ~$0.0062",
      ],
      workflow: {
        title: "Expert panel flow · live topology",
        stages: [
          {
            id: "user",
            nodes: [{ id: "q", label: "User Query", sublabel: "Benchmark case", tone: "navy" }],
          },
          {
            id: "experts",
            nodes: [
              {
                id: "a",
                label: "Expert A",
                sublabel: "z-ai/glm-5.2",
                tone: "blue",
              },
              {
                id: "b",
                label: "Expert B",
                sublabel: "step-3.7-flash",
                tone: "purple",
              },
              {
                id: "c",
                label: "Expert C",
                sublabel: "llama-3.1-8b",
                tone: "cyan",
              },
            ],
          },
          {
            id: "judge",
            nodes: [
              {
                id: "j",
                label: "Judge / Consensus",
                sublabel: "z-ai/glm-5.2",
                tone: "green",
              },
            ],
          },
          {
            id: "final",
            nodes: [
              {
                id: "f",
                label: "Final Answer",
                sublabel: "Top 3 + %",
                tone: "blue",
              },
            ],
          },
        ],
      },
      flowSteps: [
        {
          id: "s1",
          label: "1 · Case",
          kind: "user",
          title: "Benchmark case intake",
          stageId: "user",
          detail:
            "41y adult, mid-winter, post-flight exposure. Day-by-day timeline, SpO2 97–98%, vaccine history, explicit negatives. Research-only constraints applied.",
        },
        {
          id: "s2",
          label: "2 · Expert A",
          kind: "expert",
          title: "Primary analyst ranking",
          stageId: "experts",
          model: "z-ai/glm-5.2",
          detail:
            "Ranks top-3 comparable hypotheses with fit/against bullets, integer weights, and “why not ±15%”. Flags the single best missing datum.",
        },
        {
          id: "s3",
          label: "3 · Expert B",
          kind: "expert",
          title: "Red-team challenge",
          stageId: "experts",
          model: "stepfun-ai/step-3.7-flash",
          detail:
            "Audits assumptions, forces an alternate framing, and sets a red-flag re-rank trigger. Runs in parallel with A and C.",
        },
        {
          id: "s4",
          label: "4 · Expert C",
          kind: "expert",
          title: "Evidence & uncertainty",
          stageId: "experts",
          model: "meta/llama-3.1-8b-instruct",
          detail:
            "Separates known vs inferred vs unknown. Marks non-specific signals and proposes 3 non-action research questions.",
        },
        {
          id: "s5",
          label: "5 · Judge",
          kind: "judge",
          title: "Consensus top-3 + %",
          stageId: "judge",
          model: "z-ai/glm-5.2",
          detail:
            "Reads structured handoffs. Emits ranked results summing to 100%, weight defense, red-flag, and RANKINGS_JSON for the UI cards.",
        },
        {
          id: "s6",
          label: "6 · Final",
          kind: "complete",
          title: "Final answer + cost report",
          stageId: "final",
          detail:
            "Showcase cards (top-3 %), full synthesis, handoff trail. Live cost $0.00 on NIM free; Groq commercial equiv. ~$0.0062 for same tokens.",
        },
      ],
      timeline: [
        {
          id: "t1",
          label: "Case received",
          kind: "user",
          time: "00:00",
          duration: "—",
          detail:
            "Benchmark vignette loaded: post-flight winter URI, research-only panel task.",
        },
        {
          id: "t2",
          label: "Experts start (parallel)",
          kind: "system",
          time: "00:02",
          duration: "2s",
          detail:
            "Dispatch to Expert A / B / C with per-agent NVIDIA NIM models.",
        },
        {
          id: "t3",
          label: "Expert C done",
          kind: "expert",
          time: "00:24",
          duration: "22s",
          model: "meta/llama-3.1-8b-instruct",
          detail: "Evidence inventory + provisional top-3 weights returned first.",
        },
        {
          id: "t4",
          label: "Expert A done",
          kind: "expert",
          time: "00:48",
          duration: "46s",
          model: "z-ai/glm-5.2",
          detail: "Primary framing + calibrated top-3 with weight defenses.",
        },
        {
          id: "t5",
          label: "Expert B done",
          kind: "expert",
          time: "00:55",
          duration: "53s",
          model: "stepfun-ai/step-3.7-flash",
          detail: "Red-team alternate framing + re-rank trigger.",
        },
        {
          id: "t6",
          label: "Handoffs packed",
          kind: "system",
          time: "00:56",
          duration: "1s",
          detail: "3× HandoffState → Judge (hybrid_state protocol).",
        },
        {
          id: "t7",
          label: "Judge synthesis",
          kind: "judge",
          time: "01:28",
          duration: "32s",
          model: "z-ai/glm-5.2",
          detail: "Top-3 possibilities with % + RANKINGS_JSON + residual uncertainty.",
        },
        {
          id: "t8",
          label: "Final answer ready",
          kind: "complete",
          time: "01:43",
          duration: "15s",
          detail:
            "UI unlocks replay, cost report (NIM $0 · Groq equiv. $0.0062), structured JSON.",
        },
      ],
      runSummary: {
        status: "Success",
        runId: "run_mai_nim_bench",
        started: "Live Studio sample",
        duration: "01:43",
        models: [
          "z-ai/glm-5.2",
          "stepfun-ai/step-3.7-flash",
          "meta/llama-3.1-8b-instruct",
        ],
        handoffs: 3,
        tokens: 15970,
        tokensLabel: "15,970",
        cost: "$0.00",
        caseLabel: "41y post-flight winter URI · research-only",
        costCompare: {
          label: "Groq commercial equiv.",
          amount: "$0.0062",
          source: "Groq On-Demand public $/M rates",
          sourceUrl: "https://groq.com/pricing",
        },
        costBreakdown: [
          {
            role: "Expert A",
            model: "GLM-5.2 → Llama 3.3 70B",
            inputTokens: 2850,
            outputTokens: 420,
            cost: "$0.0020",
            rateNote: "$0.59/$0.79 per 1M (Groq 70B)",
          },
          {
            role: "Expert B",
            model: "Step Flash → Llama 3.1 8B",
            inputTokens: 2850,
            outputTokens: 480,
            cost: "$0.0002",
            rateNote: "$0.05/$0.08 per 1M (Groq 8B)",
          },
          {
            role: "Expert C",
            model: "Llama 8B → Llama 3.1 8B",
            inputTokens: 2850,
            outputTokens: 400,
            cost: "$0.0002",
            rateNote: "$0.05/$0.08 per 1M (Groq 8B)",
          },
          {
            role: "Judge",
            model: "GLM-5.2 → Llama 3.3 70B",
            inputTokens: 5200,
            outputTokens: 920,
            cost: "$0.0038",
            rateNote: "$0.59/$0.79 per 1M (Groq 70B)",
          },
        ],
        costNote:
          "Live Studio path uses NVIDIA NIM free trial endpoints ($0). Groq column is a consultable commercial estimate for the same token volumes using public rates from groq.com/pricing. OpenCode Zen also publishes $/M pricing (opencode.ai/docs/zen) but its models API is auth-gated.",
      },
      handoffs: [
        {
          from: "User",
          to: "Expert A",
          summary: "Benchmark case + research-only constraints.",
        },
        {
          from: "Expert A",
          to: "Judge",
          summary: "Primary top-3 weights + missing datum.",
        },
        {
          from: "Expert B",
          to: "Judge",
          summary: "Red-team alternate framing + re-rank trigger.",
        },
        {
          from: "Expert C",
          to: "Judge",
          summary: "Evidence quality + non-action research Qs.",
        },
        {
          from: "Judge",
          to: "System",
          summary: "Consensus top-3 % + RANKINGS_JSON packaged.",
        },
      ],
      sampleOutput: `{
  "case": "41y post-flight winter URI (research-only)",
  "provider_live": "NVIDIA NIM free trial",
  "cost_live_usd": 0,
  "cost_groq_equiv_usd": 0.0062,
  "pricing_source": "https://groq.com/pricing",
  "rankings": [
    { "label": "Acute viral URI syndrome", "percent": 58 },
    { "label": "Influenza-like illness", "percent": 27 },
    { "label": "COVID-like illness", "percent": 15 }
  ],
  "handoffs": 3,
  "tokens": 15970
}`,
      player: { speed: "1.0x", current: "00:00", total: "01:43" },
    },
  },
  {
    id: "coding-review",
    title: "Coding Review Orchestrator",
    description:
      "Automated code review with test feedback and iterative improvement loops.",
    category: "Coding",
    tags: [
      { label: "Coding", tone: "blue" },
      { label: "Automation", tone: "green" },
      { label: "Quality", tone: "purple" },
    ],
    accent: "green",
    workflowKind: "coding",
    metrics: {
      successRate: "94.1%",
      avgHandoffs: "8.2",
      avgLatency: "42.0s",
      totalRuns: "288",
    },
    detail: {
      longDescription:
        "Architect plans, Coder implements, Reviewer critiques, and Tester verifies. Failed checks rework through structured handoffs instead of free-text patches.",
      highlights: [
        "Plan → code → review → test",
        "Rework loop on failure",
        "File-aware handoffs",
        "Offline showcase compatible",
      ],
      workflow: {
        title: "Coding review flow",
        stages: [
          {
            id: "task",
            nodes: [{ id: "t", label: "Task Spec", tone: "navy" }],
          },
          {
            id: "plan",
            nodes: [
              {
                id: "arch",
                label: "Architect",
                sublabel: "Plan",
                tone: "blue",
              },
            ],
          },
          {
            id: "impl",
            nodes: [
              { id: "coder", label: "Coder", sublabel: "Implement", tone: "purple" },
              {
                id: "reviewer",
                label: "Reviewer",
                sublabel: "Critique",
                tone: "orange",
              },
            ],
          },
          {
            id: "test",
            nodes: [
              { id: "tester", label: "Tester", sublabel: "Verify", tone: "green" },
            ],
          },
          {
            id: "out",
            nodes: [{ id: "report", label: "Quality Report", tone: "cyan" }],
          },
        ],
      },
      timeline: [
        {
          id: "c1",
          label: "Task",
          kind: "user",
          time: "00:00",
          detail: "CLI calculator request",
        },
        {
          id: "c2",
          label: "Architect",
          kind: "agent",
          time: "00:08",
          detail: "Decisions + next steps",
        },
        {
          id: "c3",
          label: "Coder",
          kind: "agent",
          time: "00:22",
          detail: "Files attached",
        },
        {
          id: "c4",
          label: "Reviewer",
          kind: "agent",
          time: "00:35",
          detail: "Issues flagged",
        },
        {
          id: "c5",
          label: "Coder",
          kind: "agent",
          time: "00:48",
          detail: "Rework pass",
        },
        {
          id: "c6",
          label: "Tester",
          kind: "agent",
          time: "01:05",
          detail: "pytest green",
        },
        {
          id: "c7",
          label: "Complete",
          kind: "complete",
          time: "01:12",
          detail: "Report written",
        },
      ],
      runSummary: {
        status: "Success",
        runId: "run_c0d3r3v1",
        started: "May 14, 2025 3:18 PM",
        duration: "01:12",
        models: ["Llama-3.1 70B", "Echo (offline)"],
        handoffs: 9,
        tokens: 18240,
        tokensLabel: "18,240",
        cost: "$0.031",
      },
      handoffs: [
        {
          from: "Architect",
          to: "Coder",
          summary: "argparse CLI; pure math module; tests required.",
        },
        {
          from: "Coder",
          to: "Reviewer",
          summary: "calculator.py + main.py attached.",
        },
        {
          from: "Reviewer",
          to: "Coder",
          summary: "Handle divide-by-zero; tighten CLI help.",
        },
        {
          from: "Coder",
          to: "Tester",
          summary: "Rework complete; ready for pytest.",
        },
      ],
      sampleOutput: `{
  "task": "Build a pure calculator CLI using argparse",
  "files": ["calculator.py", "main.py", "test_calculator.py"],
  "quality_score": 1.0,
  "errors": [],
  "next_steps": []
}`,
      player: { speed: "1.0x", current: "00:00", total: "01:12" },
    },
  },
  {
    id: "benchmark-rescue",
    title: "Benchmark Rescue",
    description:
      "Diagnose benchmark failures, validate root cause, and generate structured reports.",
    category: "Eval",
    tags: [
      { label: "Eval", tone: "orange" },
      { label: "Reliability", tone: "green" },
      { label: "Observability", tone: "blue" },
    ],
    accent: "purple",
    workflowKind: "rescue",
    metrics: {
      successRate: "91.8%",
      avgHandoffs: "11.0",
      avgLatency: "26.4s",
      totalRuns: "156",
    },
    detail: {
      longDescription:
        "When a benchmark fails, triage agents isolate failure modes, a judge ranks root causes, a validator checks evidence, and the pipeline emits a structured rescue report.",
      highlights: [
        "Failure triage pipeline",
        "Root-cause validation",
        "Replayable eval traces",
        "Human-readable reports",
      ],
      workflow: {
        title: "Benchmark rescue flow",
        stages: [
          {
            id: "fail",
            nodes: [{ id: "f", label: "Failed Run", tone: "orange" }],
          },
          {
            id: "triage",
            nodes: [
              {
                id: "tr",
                label: "Failure Triage",
                sublabel: "Classify",
                tone: "purple",
              },
            ],
          },
          {
            id: "judge",
            nodes: [
              { id: "j", label: "Judge", sublabel: "Root cause", tone: "blue" },
              {
                id: "v",
                label: "Validator",
                sublabel: "Evidence",
                tone: "cyan",
              },
            ],
          },
          {
            id: "report",
            nodes: [{ id: "r", label: "Rescue Report", tone: "green" }],
          },
        ],
      },
      timeline: [
        {
          id: "b1",
          label: "Fail",
          kind: "system",
          time: "00:00",
          detail: "Benchmark case failed",
        },
        {
          id: "b2",
          label: "Triage",
          kind: "agent",
          time: "00:10",
          detail: "Bucketed error class",
        },
        {
          id: "b3",
          label: "Judge",
          kind: "judge",
          time: "00:24",
          detail: "Root cause ranked",
        },
        {
          id: "b4",
          label: "Validator",
          kind: "agent",
          time: "00:38",
          detail: "Evidence checked",
        },
        {
          id: "b5",
          label: "Report",
          kind: "system",
          time: "00:52",
          detail: "Markdown + JSON",
        },
        {
          id: "b6",
          label: "Complete",
          kind: "complete",
          time: "00:58",
          detail: "Artifacts stored",
        },
      ],
      runSummary: {
        status: "Success",
        runId: "run_b3nchr3s",
        started: "May 15, 2025 9:05 AM",
        duration: "00:58",
        models: ["Mixtral 8x22B", "Llama-3.1 8B"],
        handoffs: 11,
        tokens: 15602,
        tokensLabel: "15,602",
        cost: "$0.019",
      },
      handoffs: [
        {
          from: "System",
          to: "Triage",
          summary: "Failing case + raw logs attached.",
        },
        {
          from: "Triage",
          to: "Judge",
          summary: "Likely tool-schema mismatch vs model error.",
        },
        {
          from: "Judge",
          to: "Validator",
          summary: "Top root cause: invalid tool arguments.",
        },
        {
          from: "Validator",
          to: "Reporter",
          summary: "Evidence confirmed; rescue notes ready.",
        },
      ],
      sampleOutput: `{
  "benchmark": "doctor_panel_10",
  "failure_class": "tool_arguments",
  "root_cause": "Missing required field in tool call",
  "confidence": 0.91,
  "recommended_fix": "Tighten schema validation before agent step"
}`,
      player: { speed: "1.0x", current: "00:00", total: "00:58" },
    },
  },
  {
    id: "support-triage",
    title: "Support Triage",
    description:
      "Intelligent routing of user requests to the best agent for fast resolution.",
    category: "Support",
    tags: [
      { label: "Support", tone: "orange" },
      { label: "Routing", tone: "blue" },
      { label: "Production", tone: "green" },
    ],
    accent: "orange",
    workflowKind: "support",
    metrics: {
      successRate: "96.0%",
      avgHandoffs: "5.4",
      avgLatency: "9.7s",
      totalRuns: "640",
    },
    detail: {
      longDescription:
        "A router classifies inbound tickets and hands structured context to Support, Knowledge Base, or Escalation agents. SLA notes and customer replies stay on the handoff contract.",
      highlights: [
        "Intent-aware routing",
        "KB + escalation paths",
        "SLA-aware metadata",
        "Customer-ready replies",
      ],
      workflow: {
        title: "Support triage flow",
        stages: [
          {
            id: "ticket",
            nodes: [{ id: "u", label: "User Ticket", tone: "navy" }],
          },
          {
            id: "router",
            nodes: [
              { id: "r", label: "Router", sublabel: "Classify", tone: "orange" },
            ],
          },
          {
            id: "agents",
            nodes: [
              {
                id: "s",
                label: "Support Agent",
                sublabel: "Resolve",
                tone: "blue",
              },
              { id: "k", label: "KB Agent", sublabel: "Lookup", tone: "cyan" },
              {
                id: "e",
                label: "Escalation",
                sublabel: "Human",
                tone: "purple",
              },
            ],
          },
          {
            id: "reply",
            nodes: [{ id: "c", label: "Customer Reply", tone: "green" }],
          },
        ],
      },
      timeline: [
        {
          id: "s1",
          label: "Ticket",
          kind: "user",
          time: "00:00",
          detail: "Payment gateway error",
        },
        {
          id: "s2",
          label: "Router",
          kind: "system",
          time: "00:03",
          detail: "Severity: critical",
        },
        {
          id: "s3",
          label: "Support",
          kind: "agent",
          time: "00:12",
          detail: "Diagnosis started",
        },
        {
          id: "s4",
          label: "KB",
          kind: "agent",
          time: "00:18",
          detail: "Runbook matched",
        },
        {
          id: "s5",
          label: "Reply",
          kind: "agent",
          time: "00:27",
          detail: "Draft response",
        },
        {
          id: "s6",
          label: "Complete",
          kind: "complete",
          time: "00:31",
          detail: "Ticket updated",
        },
      ],
      runSummary: {
        status: "Success",
        runId: "run_sup0rt01",
        started: "May 16, 2025 11:20 AM",
        duration: "00:31",
        models: ["GPT-4o-mini", "Internal KB"],
        handoffs: 6,
        tokens: 6420,
        tokensLabel: "6,420",
        cost: "$0.008",
      },
      handoffs: [
        {
          from: "Router",
          to: "Support Agent",
          summary: "Category: payments; SLA window 4h.",
        },
        {
          from: "Support Agent",
          to: "KB Agent",
          summary: "Need pool exhaustion runbook.",
        },
        {
          from: "KB Agent",
          to: "Support Agent",
          summary: "Runbook #214 attached with steps.",
        },
        {
          from: "Support Agent",
          to: "Communicator",
          summary: "Customer-safe resolution draft ready.",
        },
      ],
      sampleOutput: `{
  "ticket_id": "TCK-10482",
  "severity": "critical",
  "route": "support_with_kb",
  "resolution": "Connection pool restart playbook applied",
  "sla_remaining_minutes": 196
}`,
      player: { speed: "1.0x", current: "00:00", total: "00:31" },
    },
  },
];

export const featuredBadges = [
  "Live NIM free",
  "Real case",
  "Top-3 + %",
  "Groq cost compare",
  "Structured handoffs",
] as const;

/** @deprecated use demos[].detail — kept for compatibility */
export const featuredWorkflow = demos[0].detail.workflow;
export const timelineEvents = demos[0].detail.timeline;
export const runSummary = demos[0].detail.runSummary;
export const playerState = {
  speed: demos[0].detail.player.speed,
  current: demos[0].detail.player.current,
  total: demos[0].detail.player.total,
  mode: "Steps" as "Steps" | "Timeline",
};

export const studioNav = [
  { label: "Overview", href: "/" },
  { label: "Demos", href: "/demos" },
  { label: "Replay", href: "/demos#replay" },
  { label: "Reports", href: "/demos#reports" },
  {
    label: "GitHub",
    href: "https://github.com/DaosPath/handoffkit",
    external: true,
  },
] as const;

export function getDemoById(id: string): DemoItem | undefined {
  return demos.find((d) => d.id === id);
}

export function getAllDemoIds(): string[] {
  return demos.map((d) => d.id);
}
