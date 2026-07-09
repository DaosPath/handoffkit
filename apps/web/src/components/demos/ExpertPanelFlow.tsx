"use client";

import type { ReactNode } from "react";
import { m, AnimatePresence } from "framer-motion";
import {
  Bot,
  Check,
  Gavel,
  Loader2,
  Sparkles,
  User,
  X,
} from "lucide-react";

export type FlowNodeStatus = "idle" | "pending" | "running" | "done" | "error";

export type FlowNodeState = {
  id: string;
  label: string;
  sublabel?: string;
  status: FlowNodeStatus;
  output?: string;
  tone?: "blue" | "green" | "purple" | "cyan" | "navy" | "orange";
};

type ExpertPanelFlowProps = {
  user: FlowNodeState;
  experts: FlowNodeState[];
  judge: FlowNodeState;
  finalNode: FlowNodeState;
  activeMessage?: string;
};

const ROLE_HINT: Record<string, string> = {
  "User Query": "Task intake",
  "Expert A": "Structured multi-perspective review",
  "Expert B": "Critique of assumptions",
  "Expert C": "Diagnostic alternatives",
  "Judge / Consensus": "Consensus synthesis",
  "Final Answer": "Structured result",
};

function statusLabel(status: FlowNodeStatus) {
  switch (status) {
    case "running":
      return "Running";
    case "done":
      return "Done";
    case "error":
      return "Error";
    case "pending":
      return "Queued";
    default:
      return "Idle";
  }
}

function StatusBadge({ status }: { status: FlowNodeStatus }) {
  return (
    <span className={`mai-status mai-status-${status}`}>
      {status === "running" && <Loader2 size={11} className="animate-spin" />}
      {status === "done" && <Check size={11} strokeWidth={2.5} />}
      {status === "error" && <X size={11} strokeWidth={2.5} />}
      {statusLabel(status)}
    </span>
  );
}

function FlowCard({
  node,
  icon,
  accent,
  wide,
}: {
  node: FlowNodeState;
  icon: ReactNode;
  accent: string;
  wide?: boolean;
}) {
  const hint = ROLE_HINT[node.label] || node.sublabel || "";
  return (
    <m.div
      layout
      className={`mai-flow-card mai-flow-${node.status} ${wide ? "mai-flow-wide" : ""}`}
    >
      <div className="flex items-start gap-3">
        <div className={`mai-flow-icon ${accent}`}>{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[0.9rem] font-semibold tracking-tight text-[var(--navy)]">
              {node.label}
            </p>
            <StatusBadge status={node.status} />
          </div>
          {hint && (
            <p className="mt-0.5 text-[0.75rem] leading-snug text-[var(--navy-muted)]">
              {hint}
            </p>
          )}
          {node.sublabel && node.sublabel !== hint && (
            <p className="mt-1 font-mono text-[0.65rem] text-[#64748b]">
              {node.sublabel}
            </p>
          )}
        </div>
      </div>
      <AnimatePresence mode="wait">
        {node.output &&
          (node.status === "done" ||
            node.status === "error" ||
            node.status === "running") && (
            <m.div
              key={node.output.slice(0, 24)}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mai-flow-output"
            >
              {node.output.length > 320
                ? `${node.output.slice(0, 320)}…`
                : node.output}
            </m.div>
          )}
      </AnimatePresence>
    </m.div>
  );
}

function Rail({ active }: { active?: boolean }) {
  return (
    <div className={`mai-rail ${active ? "mai-rail-on" : ""}`} aria-hidden>
      <span className="mai-rail-line" />
      <span className="mai-rail-dot" />
    </div>
  );
}

export function ExpertPanelFlow({
  user,
  experts,
  judge,
  finalNode,
  activeMessage,
}: ExpertPanelFlowProps) {
  const expertsActive = experts.some(
    (e) => e.status === "running" || e.status === "done"
  );
  const expertsDone = experts.every(
    (e) => e.status === "done" || e.status === "error"
  );

  return (
    <div className="mai-flow-root">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mai-kicker">Orchestration</p>
          <h3 className="text-lg font-semibold tracking-tight text-[var(--navy)]">
            Expert panel flow
          </h3>
          <p className="mt-0.5 text-[0.8rem] text-[var(--navy-muted)]">
            User → parallel experts → judge → final answer
          </p>
        </div>
        {activeMessage ? (
          <span className="mai-live-pill">
            <Loader2 size={12} className="animate-spin" />
            {activeMessage}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col items-stretch">
        <FlowCard
          node={user}
          accent="mai-icon-navy"
          icon={<User size={16} strokeWidth={2} />}
          wide
        />
        <Rail active={user.status !== "idle" || expertsActive} />

        <div>
          <p className="mb-2.5 text-center text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[#64748b]">
            Parallel experts
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {experts.map((ex, i) => (
              <FlowCard
                key={ex.id}
                node={ex}
                accent={
                  i === 0
                    ? "mai-icon-blue"
                    : i === 1
                      ? "mai-icon-purple"
                      : "mai-icon-cyan"
                }
                icon={<Bot size={16} strokeWidth={2} />}
              />
            ))}
          </div>
        </div>

        <Rail active={expertsDone || judge.status !== "idle"} />
        <FlowCard
          node={judge}
          accent="mai-icon-green"
          icon={<Gavel size={16} strokeWidth={2} />}
          wide
        />
        <Rail active={judge.status === "done" || finalNode.status !== "idle"} />
        <FlowCard
          node={finalNode}
          accent="mai-icon-blue"
          icon={<Sparkles size={16} strokeWidth={2} />}
          wide
        />
      </div>
    </div>
  );
}

export function idleMaiFlow(
  model = "meta/llama-3.1-8b-instruct",
  perAgent?: Partial<
    Record<"Expert A" | "Expert B" | "Expert C" | "Judge", string>
  >
): {
  user: FlowNodeState;
  experts: FlowNodeState[];
  judge: FlowNodeState;
  finalNode: FlowNodeState;
} {
  const a = perAgent?.["Expert A"] || model;
  const b = perAgent?.["Expert B"] || model;
  const c = perAgent?.["Expert C"] || model;
  const j = perAgent?.Judge || model;
  return {
    user: {
      id: "user",
      label: "User Query",
      sublabel: "Task intake",
      status: "idle",
    },
    experts: [
      {
        id: "Expert A",
        label: "Expert A",
        sublabel: a,
        status: "idle",
      },
      {
        id: "Expert B",
        label: "Expert B",
        sublabel: b,
        status: "idle",
      },
      {
        id: "Expert C",
        label: "Expert C",
        sublabel: c,
        status: "idle",
      },
    ],
    judge: {
      id: "judge",
      label: "Judge / Consensus",
      sublabel: j,
      status: "idle",
    },
    finalNode: {
      id: "final",
      label: "Final Answer",
      sublabel: "Structured result",
      status: "idle",
    },
  };
}
