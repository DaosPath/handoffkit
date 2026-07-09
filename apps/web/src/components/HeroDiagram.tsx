"use client";

import { m } from "framer-motion";
import { Bot, Network, Share2, User } from "lucide-react";
import { easeOut, fadeUp, stagger } from "@/lib/motion";

const agents = [
  { label: "Coder", delay: 0 },
  { label: "Research", delay: 1 },
  { label: "Support", delay: 2 },
];

function FlowArrow() {
  return (
    <div className="flex justify-center py-0.5" aria-hidden>
      <svg width="20" height="22" viewBox="0 0 20 22" className="text-[var(--blue)]/70">
        <path
          d="M10 1 v13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeDasharray="3 4"
          className="flow-arrow"
        />
        <path
          d="M5 11.5 L10 17.5 L15 11.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function HeroDiagram() {
  return (
    <div className="liquid-surface relative mx-auto w-full max-w-lg overflow-hidden p-6 sm:p-8">
      <div className="liquid-blob liquid-blob-blue absolute -left-8 -top-10 h-44 w-44" />
      <div
        className="liquid-blob liquid-blob-soft absolute -bottom-12 -right-6 h-52 w-52"
        style={{ animationDelay: "-4s" }}
      />
      <div
        className="liquid-blob liquid-blob-white absolute left-1/3 top-1/4 h-28 w-28 liquid-blob-sm"
        style={{ animationDelay: "-2s" }}
      />
      <span className="liquid-bubble left-[12%] top-[18%] h-3 w-3" />
      <span
        className="liquid-bubble right-[18%] top-[28%] h-2 w-2"
        style={{ animationDelay: "1.5s" }}
      />
      <span
        className="liquid-bubble bottom-[22%] left-[22%] h-4 w-4"
        style={{ animationDelay: "0.8s" }}
      />

      <div className="relative z-10 flex flex-col items-center">
        <m.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          transition={easeOut}
          className="pulse-soft flex items-center gap-2 rounded-2xl border border-white/80 bg-white/85 px-5 py-2.5 text-sm font-semibold text-[var(--navy)] shadow-[0_8px_22px_-8px_rgba(37,99,255,0.3)]"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-[rgba(37,99,255,0.1)] text-[var(--blue)]">
            <User size={14} />
          </span>
          User / App
        </m.div>

        <FlowArrow />

        <m.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          transition={{ ...easeOut, delay: 0.12 }}
          className="flex items-center gap-2 rounded-2xl bg-gradient-to-b from-[#3b82f6] to-[#1d4ed8] px-6 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_-8px_rgba(37,99,255,0.55)] ring-1 ring-white/25"
        >
          <Network size={16} />
          Orchestrator
        </m.div>

        <div className="mt-1 w-full">
          <div className="flex justify-center" aria-hidden>
            <svg
              width="100%"
              height="32"
              viewBox="0 0 320 32"
              preserveAspectRatio="xMidYMid meet"
              className="max-w-sm text-[var(--blue)]/45"
            >
              <path
                d="M160 0 V12 M160 12 H50 M160 12 H270 M50 12 V28 M160 12 V28 M270 12 V28"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeDasharray="3 4"
                className="flow-arrow"
              />
            </svg>
          </div>

          <div className="mt-1 grid grid-cols-3 gap-2.5 sm:gap-3">
            {agents.map((agent) => (
              <m.div
                key={agent.label}
                variants={fadeUp}
                initial="hidden"
                animate="show"
                transition={stagger(agent.delay, 0.08)}
                className="flex flex-col items-center gap-1.5 rounded-2xl border border-[rgba(37,99,255,0.14)] bg-[rgba(239,246,255,0.92)] px-2 py-3 text-center shadow-[0_8px_18px_-10px_rgba(37,99,255,0.3)]"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[var(--blue)] shadow-sm">
                  <Bot size={14} />
                </span>
                <span className="text-[0.7rem] font-semibold leading-tight text-[var(--blue-deep)] sm:text-xs">
                  {agent.label}
                </span>
                <span className="text-[0.62rem] font-medium text-[var(--navy-muted)]">
                  Agent
                </span>
              </m.div>
            ))}
          </div>
        </div>

        <FlowArrow />

        <m.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          transition={{ ...easeOut, delay: 0.28 }}
          className="flex items-center gap-2.5 rounded-2xl border border-white/90 bg-white/90 px-5 py-3 text-sm font-semibold text-[var(--navy)] shadow-[0_10px_24px_-10px_rgba(37,99,255,0.3)]"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[rgba(37,99,255,0.1)] text-[var(--blue)]">
            <Share2 size={14} />
          </span>
          <span className="leading-snug">
            Shared State
            <span className="block text-xs font-medium text-[var(--navy-muted)]">
              &amp; Report
            </span>
          </span>
        </m.div>
      </div>
    </div>
  );
}
