"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { m } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Gavel,
  Pause,
  Play,
  Scale,
  User,
  Bot,
  Cpu,
  Flag,
  Code2,
  LifeBuoy,
  FlaskConical,
  GitBranch,
  Timer,
  Sparkles,
  ShieldCheck,
  DollarSign,
  Layers,
  Zap,
} from "lucide-react";
import {
  demos,
  featuredBadges,
  type DemoItem,
  type FlowStep,
  type TimelineEvent,
} from "@/lib/demo-data";
import { easeOut, fadeUp, viewportOnce } from "@/lib/motion";

type FeaturedDemoProps = {
  demoId: string;
};

function eventIcon(kind: TimelineEvent["kind"]) {
  switch (kind) {
    case "user":
      return User;
    case "expert":
    case "agent":
      return Bot;
    case "judge":
      return Scale;
    case "system":
      return Cpu;
    case "complete":
      return Flag;
  }
}

function demoIcon(demo: DemoItem) {
  switch (demo.workflowKind) {
    case "panel":
      return Gavel;
    case "coding":
      return Code2;
    case "rescue":
      return FlaskConical;
    case "support":
      return LifeBuoy;
  }
}

function fallbackSteps(demo: DemoItem): FlowStep[] {
  return demo.detail.workflow.stages.flatMap((stage, i) =>
    stage.nodes.map((n, j) => ({
      id: `${stage.id}-${n.id}`,
      label: `${i + 1}.${j + 1}`,
      kind: (stage.id === "judge"
        ? "judge"
        : stage.id === "user"
          ? "user"
          : stage.id === "final"
            ? "complete"
            : "expert") as FlowStep["kind"],
      title: n.label,
      detail: n.sublabel || demo.description,
      model: n.sublabel,
      stageId: stage.id,
    }))
  );
}

export function FeaturedDemo({ demoId }: FeaturedDemoProps) {
  const demo: DemoItem = useMemo(
    () => demos.find((d) => d.id === demoId) ?? demos[0],
    [demoId]
  );
  const { detail, metrics } = demo;
  const flowSteps = detail.flowSteps?.length
    ? detail.flowSteps
    : fallbackSteps(demo);
  const timeline = detail.timeline;

  const [mode, setMode] = useState<"Steps" | "Timeline">("Steps");
  const [activeStep, setActiveStep] = useState(0);
  const [activeTime, setActiveTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const Icon = demoIcon(demo);

  const activeStageId =
    mode === "Steps"
      ? flowSteps[activeStep]?.stageId
      : timeline[activeTime]?.kind === "user"
        ? "user"
        : timeline[activeTime]?.kind === "judge"
          ? "judge"
          : timeline[activeTime]?.kind === "complete"
            ? "final"
            : timeline[activeTime]?.kind === "expert"
              ? "experts"
              : undefined;

  // Auto-advance within the active mode only
  useEffect(() => {
    if (!playing) return;
    const max =
      mode === "Steps" ? flowSteps.length - 1 : timeline.length - 1;
    const id = setInterval(() => {
      if (mode === "Steps") {
        setActiveStep((s) => {
          if (s >= max) {
            setPlaying(false);
            return s;
          }
          return s + 1;
        });
      } else {
        setActiveTime((s) => {
          if (s >= max) {
            setPlaying(false);
            return s;
          }
          return s + 1;
        });
      }
    }, 1400);
    return () => clearInterval(id);
  }, [playing, mode, flowSteps.length, timeline.length]);

  useEffect(() => {
    setPlaying(false);
    setActiveStep(0);
    setActiveTime(0);
  }, [demo.id]);

  const currentLabel =
    mode === "Steps"
      ? flowSteps[activeStep]?.label
      : timeline[activeTime]?.time;
  const totalLabel =
    mode === "Steps"
      ? String(flowSteps.length)
      : detail.player.total;

  return (
    <section id="replay" className="relative px-4 py-12 sm:px-6 sm:py-16">
      <m.div
        key={demo.id}
        variants={fadeUp}
        initial="hidden"
        whileInView="show"
        viewport={viewportOnce}
        transition={easeOut}
        className="liquid-shell mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8"
      >
        <div className="relative z-10 grid gap-8 lg:grid-cols-[0.9fr_1.2fr_0.85fr]">
          {/* Left — synthesis / CTA */}
          <div className="feat-side">
            <div className="feat-side-kicker">
              <span className="feat-side-live">
                <span className="feat-side-live-dot" />
                Featured · Live topology
              </span>
              <span className="feat-side-cat">{demo.category}</span>
            </div>

            <div className="feat-side-title-row">
              <div className="feat-side-icon" aria-hidden>
                <Icon size={22} strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <h2 className="feat-side-title">{demo.title}</h2>
                <p className="feat-side-sub">
                  Research-only multi-agent consensus · NVIDIA NIM free
                </p>
              </div>
            </div>

            <p className="feat-side-desc">{demo.description}</p>

            {detail.runSummary.caseLabel && (
              <div className="feat-side-case">
                <div className="feat-side-case-top">
                  <Sparkles size={13} strokeWidth={2.4} />
                  <span>Case synthesis</span>
                </div>
                <p className="feat-side-case-label">
                  {detail.runSummary.caseLabel}
                </p>
                <p className="feat-side-case-body">{detail.longDescription}</p>
              </div>
            )}

            <ul className="feat-side-highlights">
              {detail.highlights.map((h) => (
                <li key={h}>
                  <ShieldCheck size={14} strokeWidth={2.3} aria-hidden />
                  <span>{h}</span>
                </li>
              ))}
            </ul>

            <div className="feat-side-tags">
              {demo.tags.map((t) => (
                <span key={t.label} className={`tag-pill tag-pill-${t.tone}`}>
                  {t.label}
                </span>
              ))}
              {featuredBadges.slice(0, 3).map((b) => (
                <span key={b} className="feat-side-pill">
                  {b}
                </span>
              ))}
            </div>

            <div className="feat-side-metrics">
              {[
                {
                  label: "Panel latency",
                  value: metrics.avgLatency,
                  icon: Timer,
                  hint: "NIM slow · Groq fast",
                },
                {
                  label: "Handoffs",
                  value: metrics.avgHandoffs,
                  icon: Layers,
                  hint: "typical live run",
                },
                {
                  label: "Live cost",
                  value: detail.runSummary.cost,
                  icon: DollarSign,
                  hint: "NIM free trial",
                },
                {
                  label: "Groq metered",
                  value: detail.runSummary.costCompare?.amount ?? "—",
                  icon: Zap,
                  hint: "public $/M rates",
                },
              ].map((row) => {
                const MIcon = row.icon;
                return (
                  <div key={row.label} className="feat-side-metric">
                    <span className="feat-side-metric-icon" aria-hidden>
                      <MIcon size={13} strokeWidth={2.3} />
                    </span>
                    <div className="min-w-0">
                      <p className="feat-side-metric-value">{row.value}</p>
                      <p className="feat-side-metric-label">{row.label}</p>
                      <p className="feat-side-metric-hint">{row.hint}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="feat-side-actions">
              <Link
                href={`/demos/${demo.id}`}
                className="liquid-button feat-side-cta !text-sm"
              >
                View full demo
                <ArrowRight size={14} />
              </Link>
              <Link
                href={`/demos/${demo.id}#live-run`}
                className="liquid-button-secondary feat-side-cta !text-sm"
              >
                <Play size={13} fill="currentColor" />
                Run live panel
              </Link>
            </div>
            <p className="feat-side-footnote">
              Topology matches Studio live run · costs from NIM free trial +{" "}
              <a
                href="https://groq.com/pricing"
                target="_blank"
                rel="noreferrer"
              >
                Groq public pricing
              </a>
              .
            </p>
          </div>

          {/* Center — Expert panel flow */}
          <div className="min-w-0">
            <div className="liquid-card !rounded-[28px] p-5 sm:p-6">
              <div className="relative z-10">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.1em] text-[var(--navy-muted)]">
                      {detail.workflow.title}
                    </p>
                    {detail.runSummary.caseLabel && (
                      <p className="mt-1 text-[0.72rem] font-semibold text-[var(--navy)]">
                        {detail.runSummary.caseLabel}
                      </p>
                    )}
                  </div>
                  <div className="flex rounded-full border border-[rgba(37,99,255,0.12)] bg-white/80 p-0.5">
                    {(
                      [
                        { id: "Steps" as const, icon: GitBranch, hint: "Orchestration" },
                        { id: "Timeline" as const, icon: Timer, hint: "Clock order" },
                      ] as const
                    ).map((tab) => {
                      const TabIcon = tab.icon;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => {
                            setMode(tab.id);
                            setPlaying(false);
                          }}
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.7rem] font-semibold transition ${
                            mode === tab.id
                              ? "bg-[rgba(37,99,255,0.12)] text-[var(--blue-deep)]"
                              : "text-[var(--navy-muted)]"
                          }`}
                          title={tab.hint}
                        >
                          <TabIcon size={12} strokeWidth={2.2} />
                          {tab.id}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Workflow graph — highlight by active stage */}
                <div className="flex flex-col items-center gap-1">
                  {detail.workflow.stages.map((stage, si) => {
                    const lit =
                      !activeStageId || activeStageId === stage.id;
                    return (
                      <div
                        key={stage.id}
                        className="flex w-full flex-col items-center"
                      >
                        <div
                          className={`flex flex-wrap justify-center gap-2 transition-opacity duration-200 ${
                            lit ? "opacity-100" : "opacity-40"
                          }`}
                        >
                          {stage.nodes.map((node) => (
                            <div
                              key={node.id}
                              className={`workflow-node workflow-node-${node.tone ?? "blue"} ${
                                activeStageId === stage.id
                                  ? "workflow-node-active"
                                  : ""
                              }`}
                            >
                              <span>{node.label}</span>
                              {node.sublabel ? (
                                <span className="workflow-node-sub">
                                  {node.sublabel}
                                </span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                        {si < detail.workflow.stages.length - 1 && (
                          <div
                            className={`workflow-line my-1 ${
                              activeStageId === stage.id ? "workflow-line-on" : ""
                            }`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Mode-specific player */}
                <div className="mt-6 rounded-2xl border border-[rgba(37,99,255,0.1)] bg-white/60 p-3 sm:p-4">
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <button
                      type="button"
                      onClick={() => setPlaying((p) => !p)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-b from-[#3b82f6] to-[#1d4ed8] text-white shadow-[0_8px_18px_-4px_rgba(37,99,255,0.5)]"
                      aria-label={playing ? "Pause" : "Play"}
                    >
                      {playing ? (
                        <Pause size={14} fill="currentColor" />
                      ) : (
                        <Play
                          size={14}
                          fill="currentColor"
                          className="ml-0.5"
                        />
                      )}
                    </button>
                    <span className="liquid-pill !cursor-default !py-1 !text-xs">
                      {mode === "Steps" ? "Orchestration" : "Wall clock"}
                    </span>
                    <span className="font-mono text-xs text-[var(--navy-muted)]">
                      {mode === "Steps"
                        ? `Step ${activeStep + 1} / ${flowSteps.length}`
                        : `${timeline[activeTime]?.time ?? "00:00"} / ${totalLabel}`}
                    </span>
                    <span className="ml-auto text-[0.62rem] font-semibold uppercase tracking-[0.06em] text-[var(--navy-muted)]">
                      {mode === "Steps" ? "Stages" : "Events"} · {currentLabel}
                    </span>
                  </div>

                  {mode === "Steps" ? (
                    <StepsPanel
                      steps={flowSteps}
                      active={activeStep}
                      onSelect={(i) => {
                        setPlaying(false);
                        setActiveStep(i);
                      }}
                    />
                  ) : (
                    <TimelinePanel
                      events={timeline}
                      active={activeTime}
                      onSelect={(i) => {
                        setPlaying(false);
                        setActiveTime(i);
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right */}
          <div id="reports" className="min-w-0">
            <div className="liquid-card h-full !rounded-[28px] p-5 sm:p-6">
              <div className="relative z-10">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-[var(--navy)]">
                    Run Summary
                  </h3>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(16,185,129,0.12)] px-2 py-0.5 text-[0.68rem] font-bold text-[#059669]">
                    <CheckCircle2 size={12} />
                    {detail.runSummary.status}
                  </span>
                </div>

                {detail.runSummary.caseLabel && (
                  <p className="mb-3 rounded-xl border border-[rgba(37,99,255,0.1)] bg-[rgba(37,99,255,0.04)] px-3 py-2 text-[0.72rem] leading-relaxed text-[var(--navy-muted)]">
                    <span className="font-bold text-[var(--navy)]">Case · </span>
                    {detail.runSummary.caseLabel}
                  </p>
                )}

                <dl className="space-y-3 text-sm">
                  <Row label="Run ID" value={detail.runSummary.runId} mono />
                  <Row label="Started" value={detail.runSummary.started} />
                  <Row
                    label="Duration"
                    value={
                      <span className="inline-flex items-center gap-1">
                        <Clock size={12} className="text-[var(--blue)]" />
                        {detail.runSummary.duration}
                      </span>
                    }
                  />
                  <Row
                    label="Models"
                    value={
                      <span className="flex flex-wrap justify-end gap-1">
                        {detail.runSummary.models.map((model) => (
                          <span key={model} className="tag-pill tag-pill-blue">
                            {model.split("/").pop() || model}
                          </span>
                        ))}
                      </span>
                    }
                  />
                  <Row
                    label="Handoffs"
                    value={String(detail.runSummary.handoffs)}
                  />
                  <Row label="Tokens" value={detail.runSummary.tokensLabel} />
                  <Row
                    label="Live cost"
                    value={
                      <span className="inline-flex flex-col items-end gap-0.5">
                        <span className="text-[#059669]">
                          {detail.runSummary.cost}
                        </span>
                        <span className="text-[0.6rem] font-medium text-[var(--navy-muted)]">
                          NVIDIA NIM free trial
                        </span>
                      </span>
                    }
                  />
                  {detail.runSummary.costCompare && (
                    <Row
                      label="Commercial"
                      value={
                        <span className="inline-flex flex-col items-end gap-0.5">
                          <span>{detail.runSummary.costCompare.amount}</span>
                          <a
                            href={detail.runSummary.costCompare.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[0.6rem] font-semibold text-[var(--blue)] underline-offset-2 hover:underline"
                          >
                            {detail.runSummary.costCompare.label} ↗
                          </a>
                        </span>
                      }
                    />
                  )}
                </dl>

                {detail.runSummary.costBreakdown &&
                  detail.runSummary.costBreakdown.length > 0 && (
                    <div className="mt-4 rounded-2xl border border-[rgba(37,99,255,0.1)] bg-white/70 p-3">
                      <p className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--navy-muted)]">
                        Groq equiv. breakdown
                      </p>
                      <ul className="mt-2 space-y-2">
                        {detail.runSummary.costBreakdown.map((line) => (
                          <li
                            key={`${line.role}-${line.model}`}
                            className="flex items-start justify-between gap-2 border-b border-[rgba(37,99,255,0.06)] pb-2 last:border-0 last:pb-0"
                          >
                            <div className="min-w-0">
                              <p className="text-[0.72rem] font-bold text-[var(--navy)]">
                                {line.role}
                              </p>
                              <p className="truncate text-[0.62rem] text-[var(--navy-muted)]">
                                {line.model}
                              </p>
                              <p className="text-[0.58rem] text-[#94a3b8]">
                                {line.inputTokens + line.outputTokens} tok ·{" "}
                                {line.rateNote}
                              </p>
                            </div>
                            <span className="shrink-0 font-mono text-[0.72rem] font-bold text-[var(--navy)]">
                              {line.cost}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                <p className="mt-3 text-[0.65rem] leading-relaxed text-[var(--navy-muted)]">
                  {detail.runSummary.costNote ||
                    "Token volumes from a real multi-agent topology; commercial cost uses public Groq rates."}
                </p>

                <Link
                  href={`/demos/${demo.id}#live-run`}
                  className="liquid-button mt-5 w-full !text-sm"
                >
                  Open live run
                  <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </m.div>
    </section>
  );
}

function StepsPanel({
  steps,
  active,
  onSelect,
}: {
  steps: FlowStep[];
  active: number;
  onSelect: (i: number) => void;
}) {
  const current = steps[active];
  const Icon = eventIcon(current?.kind ?? "system");

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-1.5">
        {steps.map((step, i) => (
          <button
            key={step.id}
            type="button"
            onClick={() => onSelect(i)}
            className={`rounded-full border px-2.5 py-1 text-[0.68rem] font-bold transition ${
              i === active
                ? "border-[rgba(37,99,255,0.35)] bg-[rgba(37,99,255,0.12)] text-[var(--blue-deep)]"
                : i < active
                  ? "border-[rgba(16,185,129,0.25)] bg-[rgba(16,185,129,0.08)] text-[#047857]"
                  : "border-[rgba(148,163,184,0.35)] bg-white text-[var(--navy-muted)]"
            }`}
          >
            {step.label}
          </button>
        ))}
      </div>

      {current && (
        <div className="mt-3 rounded-xl border border-[rgba(37,99,255,0.1)] bg-gradient-to-b from-white to-[#f8fafc] p-3.5">
          <div className="flex items-start gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[rgba(37,99,255,0.1)] text-[var(--blue)]">
              <Icon size={16} strokeWidth={2.2} />
            </span>
            <div className="min-w-0">
              <p className="text-[0.62rem] font-bold uppercase tracking-[0.08em] text-[var(--blue)]">
                Step {active + 1} · orchestration
              </p>
              <p className="mt-0.5 text-[0.92rem] font-bold tracking-tight text-[var(--navy)]">
                {current.title}
              </p>
              {current.model && (
                <p className="mt-1 font-mono text-[0.65rem] text-[var(--navy-muted)]">
                  {current.model}
                </p>
              )}
              <p className="mt-2 text-[0.78rem] leading-relaxed text-[var(--navy-muted)]">
                {current.detail}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TimelinePanel({
  events,
  active,
  onSelect,
}: {
  events: TimelineEvent[];
  active: number;
  onSelect: (i: number) => void;
}) {
  const current = events[active];

  return (
    <div className="mt-4">
      <p className="mb-2 text-[0.62rem] font-bold uppercase tracking-[0.08em] text-[var(--navy-muted)]">
        Wall-clock run log · not the same as Steps
      </p>
      <ol className="feat-timeline-list">
        {events.map((ev, i) => {
          const EvIcon = eventIcon(ev.kind);
          const isActive = i === active;
          const past = i < active;
          return (
            <li key={ev.id}>
              <button
                type="button"
                onClick={() => onSelect(i)}
                className={`feat-timeline-row${isActive ? " is-active" : ""}${
                  past ? " is-past" : ""
                }`}
              >
                <span className="feat-timeline-time font-mono">{ev.time}</span>
                <span className="feat-timeline-rail" aria-hidden>
                  <span className="feat-timeline-dot">
                    <EvIcon size={11} strokeWidth={2.2} />
                  </span>
                </span>
                <span className="feat-timeline-body">
                  <span className="feat-timeline-title-row">
                    <span className="feat-timeline-title">{ev.label}</span>
                    {ev.duration && ev.duration !== "—" && (
                      <span className="feat-timeline-dur">{ev.duration}</span>
                    )}
                  </span>
                  {ev.model && (
                    <span className="feat-timeline-model">{ev.model}</span>
                  )}
                  {isActive && ev.detail && (
                    <span className="feat-timeline-detail">{ev.detail}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {current?.detail && (
        <p className="mt-3 text-[0.7rem] leading-relaxed text-[var(--navy-muted)] sm:hidden">
          {current.detail}
        </p>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[rgba(37,99,255,0.06)] pb-2.5 last:border-0">
      <dt className="shrink-0 text-xs font-medium text-[var(--navy-muted)]">
        {label}
      </dt>
      <dd
        className={`text-right text-xs font-semibold text-[var(--navy)] ${
          mono ? "break-all font-mono" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
