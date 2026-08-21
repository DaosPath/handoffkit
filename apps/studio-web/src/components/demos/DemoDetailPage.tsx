"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { m } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  Code2,
  Cpu,
  Flag,
  FlaskConical,
  Gavel,
  LifeBuoy,
  Play,
  Scale,
  User,
} from "lucide-react";
import type { DemoItem, TimelineEvent } from "@/lib/demo-data";
import { demos } from "@/lib/demo-data";
import { MotionProvider } from "@/components/MotionProvider";
import { StudioNavbar } from "./StudioNavbar";
import { StudioFooter } from "./StudioFooter";
import { MaiPanelLive } from "./MaiPanelLive";
import { easeOut, fadeUp, stagger, viewportOnce } from "@/lib/motion";

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

function demoHeroIcon(demo: DemoItem) {
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

const accentGlow: Record<DemoItem["accent"], string> = {
  blue: "from-[#3b82f6] to-[#1d4ed8]",
  green: "from-[#34d399] to-[#059669]",
  purple: "from-[#a78bfa] to-[#7c3aed]",
  orange: "from-[#fb923c] to-[#ea580c]",
};

export function DemoDetailPage({ demo }: { demo: DemoItem }) {
  const { detail } = demo;
  const [activeStep, setActiveStep] = useState(0);
  const [mode, setMode] = useState<"Steps" | "Timeline">("Steps");
  const Icon = demoHeroIcon(demo);
  const others = demos.filter((d) => d.id !== demo.id);

  return (
    <MotionProvider>
      <div className="relative min-h-screen">
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="liquid-blob liquid-blob-blue absolute -left-28 top-32 h-80 w-80 opacity-30" />
          <div
            className="liquid-blob liquid-blob-soft absolute -right-24 top-60 h-96 w-96 opacity-35"
            style={{ animationDelay: "-5s" }}
          />
        </div>

        <StudioNavbar />

        {/* Hero */}
        <section className="relative overflow-hidden px-4 pb-8 pt-10 sm:px-6 sm:pt-14">
          <div className="relative z-10 mx-auto max-w-[1400px]">
            <Link
              href="/demos"
              className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--navy-muted)] transition hover:text-[var(--blue)]"
            >
              <ArrowLeft size={15} />
              Back to demos
            </Link>

            <m.div
              variants={fadeUp}
              initial="hidden"
              animate="show"
              transition={easeOut}
              className="liquid-shell p-6 sm:p-8 lg:p-10"
            >
              <div className="relative z-10 grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
                <div>
                  <div className="mb-4 flex flex-wrap items-center gap-3">
                    <div
                      className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-b ${accentGlow[demo.accent]} text-white shadow-[0_12px_28px_-8px_rgba(37,99,255,0.45)]`}
                    >
                      <Icon size={26} />
                    </div>
                    {demo.featured && (
                      <span className="rounded-full bg-gradient-to-r from-[#2563FF] to-[#60A5FA] px-2.5 py-0.5 text-[0.65rem] font-bold text-white">
                        Featured
                      </span>
                    )}
                    <span className={`tag-pill tag-pill-${demo.tags[0]?.tone ?? "blue"}`}>
                      {demo.category}
                    </span>
                  </div>

                  <h1 className="text-[clamp(1.75rem,3.5vw,2.6rem)] font-extrabold tracking-[-0.035em] text-[var(--navy)]">
                    {demo.title}
                  </h1>
                  <p className="mt-3 max-w-2xl text-base leading-relaxed text-[var(--navy-muted)]">
                    {detail.longDescription}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {demo.tags.map((tag) => (
                      <span
                        key={tag.label}
                        className={`tag-pill tag-pill-${tag.tone}`}
                      >
                        {tag.label}
                      </span>
                    ))}
                  </div>

                  <ul className="mt-6 grid gap-2 sm:grid-cols-2">
                    {detail.highlights.map((h) => (
                      <li
                        key={h}
                        className="flex items-start gap-2 text-sm text-[var(--navy-muted)]"
                      >
                        <CheckCircle2
                          size={16}
                          className="mt-0.5 shrink-0 text-[var(--blue)]"
                        />
                        {h}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-6 flex flex-wrap gap-2">
                    {demo.id === "mai-style-panel" ? (
                      <a href="#live-run" className="liquid-button !text-sm">
                        Run with NVIDIA
                        <Play size={14} fill="currentColor" />
                      </a>
                    ) : (
                      <button
                        type="button"
                        className="liquid-button !text-sm"
                        disabled
                        title="Live runner first for MAI panel"
                      >
                        Run This Demo
                        <Play size={14} fill="currentColor" />
                      </button>
                    )}
                    <a
                      href={
                        demo.id === "mai-style-panel"
                          ? "#live-run"
                          : "#replay-panel"
                      }
                      className="liquid-button-secondary !text-sm"
                    >
                      {demo.id === "mai-style-panel"
                        ? "Jump to panel"
                        : "Jump to replay"}
                    </a>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Success Rate", value: demo.metrics.successRate },
                    { label: "Avg. Handoffs", value: demo.metrics.avgHandoffs },
                    { label: "Avg. Latency", value: demo.metrics.avgLatency },
                    { label: "Total Runs", value: demo.metrics.totalRuns },
                  ].map((m) => (
                    <div key={m.label} className="liquid-card !rounded-2xl p-4">
                      <div className="relative z-10">
                        <p className="text-xl font-extrabold text-[var(--navy)]">
                          {m.value}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--navy-muted)]">
                          {m.label}
                        </p>
                      </div>
                    </div>
                  ))}
                  <p className="col-span-2 text-[0.65rem] text-[var(--navy-muted)]">
                    Mock metrics for UI preview only.
                  </p>
                </div>
              </div>
            </m.div>
          </div>
        </section>

        {/* MAI: single live Expert Panel Flow (no static duplicate below) */}
        {demo.id === "mai-style-panel" && (
          <div id="live-run">
            <MaiPanelLive />
          </div>
        )}

        {/* Other demos: static workflow preview */}
        {demo.id !== "mai-style-panel" && (
        <section
          id="replay-panel"
          className="relative px-4 py-8 sm:px-6 sm:py-10"
        >
          <div className="mx-auto grid max-w-[1400px] gap-5 lg:grid-cols-[1.25fr_0.75fr]">
            <m.div
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              viewport={viewportOnce}
              transition={easeOut}
              className="liquid-shell p-5 sm:p-7"
            >
              <div className="relative z-10">
                <h2 className="text-lg font-bold text-[var(--navy)]">
                  {detail.workflow.title}
                </h2>
                <p className="mt-1 text-sm text-[var(--navy-muted)]">
                  Structured handoffs between each stage.
                </p>

                <div className="mt-6 flex flex-col items-center gap-1">
                  {detail.workflow.stages.map((stage, si) => (
                    <div
                      key={stage.id}
                      className="flex w-full flex-col items-center"
                    >
                      <div className="flex flex-wrap justify-center gap-2">
                        {stage.nodes.map((node) => (
                          <div
                            key={node.id}
                            className={`workflow-node workflow-node-${node.tone ?? "blue"}`}
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
                        <div className="workflow-line my-1.5" />
                      )}
                    </div>
                  ))}
                </div>

                {/* Player */}
                <div className="mt-8 rounded-2xl border border-[rgba(37,99,255,0.1)] bg-white/65 p-4">
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        setActiveStep((s) =>
                          s >= detail.timeline.length - 1 ? 0 : s + 1
                        )
                      }
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-b from-[#3b82f6] to-[#1d4ed8] text-white shadow-[0_8px_18px_-4px_rgba(37,99,255,0.5)]"
                      aria-label="Advance step"
                    >
                      <Play size={15} fill="currentColor" className="ml-0.5" />
                    </button>
                    <span className="liquid-pill !cursor-default !text-xs">
                      {detail.player.speed}
                    </span>
                    <span className="font-mono text-xs text-[var(--navy-muted)]">
                      {detail.timeline[activeStep]?.time ?? detail.player.current}{" "}
                      / {detail.player.total}
                    </span>
                    <div className="ml-auto flex rounded-full border border-[rgba(37,99,255,0.12)] bg-white/80 p-0.5">
                      {(["Steps", "Timeline"] as const).map((label) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => setMode(label)}
                          className={`rounded-full px-2.5 py-1 text-[0.7rem] font-semibold ${
                            mode === label
                              ? "bg-[rgba(37,99,255,0.12)] text-[var(--blue-deep)]"
                              : "text-[var(--navy-muted)]"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 overflow-x-auto">
                    <div className="timeline-track">
                      {detail.timeline.map((ev, i) => {
                        const EvIcon = eventIcon(ev.kind);
                        const active = i === activeStep;
                        return (
                          <button
                            key={ev.id}
                            type="button"
                            className="timeline-node"
                            onClick={() => setActiveStep(i)}
                          >
                            <span
                              className={`timeline-dot ${
                                active ? "timeline-dot-active" : ""
                              }`}
                            >
                              <EvIcon size={12} />
                            </span>
                            <span className="text-[0.62rem] font-semibold text-[var(--navy)]">
                              {ev.label}
                            </span>
                            <span className="font-mono text-[0.58rem] text-[var(--navy-muted)]">
                              {ev.time}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {detail.timeline[activeStep]?.detail && (
                    <p className="mt-3 rounded-xl bg-[rgba(37,99,255,0.06)] px-3 py-2 text-xs text-[var(--navy-muted)]">
                      <span className="font-semibold text-[var(--navy)]">
                        {detail.timeline[activeStep].label}:
                      </span>{" "}
                      {detail.timeline[activeStep].detail}
                    </p>
                  )}
                </div>
              </div>
            </m.div>

            {/* Run summary */}
            <m.div
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              viewport={viewportOnce}
              transition={{ ...easeOut, delay: 0.06 }}
              className="liquid-card h-fit !rounded-[28px] p-5 sm:p-6"
            >
              <div className="relative z-10">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[var(--navy)]">
                    Run Summary
                  </h3>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(16,185,129,0.12)] px-2 py-0.5 text-[0.68rem] font-bold text-[#059669]">
                    <CheckCircle2 size={12} />
                    {detail.runSummary.status}
                  </span>
                </div>
                <dl className="space-y-3">
                  <SummaryRow label="Run ID" value={detail.runSummary.runId} mono />
                  <SummaryRow label="Started" value={detail.runSummary.started} />
                  <SummaryRow
                    label="Duration"
                    value={
                      <span className="inline-flex items-center gap-1">
                        <Clock size={12} className="text-[var(--blue)]" />
                        {detail.runSummary.duration}
                      </span>
                    }
                  />
                  <SummaryRow
                    label="Models"
                    value={
                      <span className="flex flex-wrap justify-end gap-1">
                        {detail.runSummary.models.map((model) => (
                          <span key={model} className="tag-pill tag-pill-blue">
                            {model}
                          </span>
                        ))}
                      </span>
                    }
                  />
                  <SummaryRow
                    label="Handoffs"
                    value={String(detail.runSummary.handoffs)}
                  />
                  <SummaryRow
                    label="Tokens"
                    value={detail.runSummary.tokensLabel}
                  />
                  <SummaryRow label="Cost" value={detail.runSummary.cost} />
                </dl>
                <p className="mt-3 text-[0.65rem] text-[var(--navy-muted)]">
                  Mock run data — not connected to a live backend.
                </p>
              </div>
            </m.div>
          </div>
        </section>
        )}

        {/* Mock handoff trail + sample only for non-live demos */}
        {demo.id !== "mai-style-panel" && (
          <>
            <section className="px-4 py-6 sm:px-6 sm:py-8">
              <div className="mx-auto max-w-[1400px]">
                <h2 className="mb-4 text-lg font-bold text-[var(--navy)]">
                  Handoff trail
                </h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {detail.handoffs.map((h, i) => (
                    <m.article
                      key={`${h.from}-${h.to}-${i}`}
                      variants={fadeUp}
                      initial="hidden"
                      whileInView="show"
                      viewport={viewportOnce}
                      transition={stagger(i, 0.04)}
                      className="liquid-card !rounded-2xl p-4 sm:p-5"
                    >
                      <div className="relative z-10">
                        <p className="text-xs font-bold text-[var(--blue)]">
                          {h.from}
                          <span className="mx-1.5 text-[var(--navy-muted)]">→</span>
                          {h.to}
                        </p>
                        <p className="mt-1.5 text-sm text-[var(--navy-muted)]">
                          {h.summary}
                        </p>
                      </div>
                    </m.article>
                  ))}
                </div>
              </div>
            </section>

            <section className="px-4 py-6 sm:px-6 sm:py-8">
              <div className="liquid-shell mx-auto max-w-[1400px] p-5 sm:p-7">
                <div className="relative z-10">
                  <h2 className="text-lg font-bold text-[var(--navy)]">
                    Sample structured output
                  </h2>
                  <p className="mt-1 text-sm text-[var(--navy-muted)]">
                    Illustrative JSON from a mock run — for UI and docs only.
                  </p>
                  <div className="code-block mt-4">
                    <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
                      <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
                      <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
                      <span className="ml-2 font-mono text-[0.7rem] text-slate-500">
                        sample_output.json
                      </span>
                    </div>
                    <pre>
                      <code className="block whitespace-pre-wrap break-words p-4 font-mono text-[0.78rem] leading-relaxed text-slate-200">
                        {detail.sampleOutput}
                      </code>
                    </pre>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {/* Related demos */}
        <section className="px-4 py-10 sm:px-6 sm:py-12">
          <div className="mx-auto max-w-[1400px]">
            <h2 className="mb-4 text-lg font-bold text-[var(--navy)]">
              More demos
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {others.map((d) => (
                <Link
                  key={d.id}
                  href={`/demos/${d.id}`}
                  className="liquid-card group block p-5 !rounded-2xl no-underline"
                >
                  <div className="relative z-10">
                    <p className="font-semibold text-[var(--navy)] group-hover:text-[var(--blue)]">
                      {d.title}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--navy-muted)]">
                      {d.description}
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--blue)]">
                      Open demo <ArrowRight size={12} />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <StudioFooter />
      </div>
    </MotionProvider>
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
