"use client";

import { motion } from "framer-motion";
import { Bot, Network, Share2, User } from "lucide-react";

const agents = [
  { label: "Research", full: "Research Agent" },
  { label: "Coder", full: "Coder Agent" },
  { label: "Support", full: "Support Agent" },
];

function FlowArrow({ className = "" }: { className?: string }) {
  return (
    <div className={`flex justify-center py-1 ${className}`} aria-hidden>
      <svg width="18" height="20" viewBox="0 0 18 20" className="text-[var(--blue)]/70">
        <path
          d="M9 1 v12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeDasharray="3 4"
          className="flow-arrow"
        />
        <path
          d="M4.5 10.5 L9 16 L13.5 10.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function DocsDiagram() {
  return (
    <div className="liquid-surface relative overflow-hidden p-5 sm:p-6">
      {/* Ambient */}
      <div className="liquid-blob liquid-blob-blue absolute -left-10 -top-12 h-40 w-40 opacity-50" />
      <div
        className="liquid-blob liquid-blob-soft absolute -bottom-14 -right-8 h-44 w-44 opacity-45"
        style={{ animationDelay: "-3s" }}
      />
      <span className="liquid-bubble left-[12%] top-[12%] h-2 w-2" />
      <span
        className="liquid-bubble right-[14%] top-[22%] h-2.5 w-2.5"
        style={{ animationDelay: "1s" }}
      />

      <div className="relative z-10">
        <p className="mb-4 text-center text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[var(--blue)]">
          How a run flows
        </p>

        {/* User */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mx-auto flex w-fit items-center gap-2 rounded-2xl border border-white/80 bg-white/85 px-4 py-2.5 text-sm font-semibold text-[var(--navy)] shadow-[0_8px_20px_-8px_rgba(37,99,255,0.28)] backdrop-blur-md"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-[rgba(37,99,255,0.1)] text-[var(--blue)]">
            <User size={14} />
          </span>
          User / App
        </motion.div>

        <FlowArrow />

        {/* Team / Protocol hub */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="mx-auto flex w-fit items-center gap-2 rounded-2xl bg-gradient-to-b from-[#3b82f6] to-[#1d4ed8] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_-8px_rgba(37,99,255,0.55)] ring-1 ring-white/25"
        >
          <Network size={15} />
          Team / Protocol
        </motion.div>

        {/* Branch lines + agents in a row */}
        <div className="relative mt-1">
          <div className="flex justify-center py-1" aria-hidden>
            <svg
              width="100%"
              height="28"
              viewBox="0 0 280 28"
              preserveAspectRatio="xMidYMid meet"
              className="max-w-[280px] text-[var(--blue)]/50"
            >
              <path
                d="M140 0 V10 M140 10 H40 M140 10 H240 M40 10 V26 M140 10 V26 M240 10 V26"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeDasharray="3 4"
                className="flow-arrow"
              />
            </svg>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {agents.map((agent, i) => (
              <motion.div
                key={agent.full}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.08 * i }}
                title={agent.full}
                className="flex flex-col items-center gap-1.5 rounded-2xl border border-[rgba(37,99,255,0.14)] bg-[rgba(239,246,255,0.9)] px-1.5 py-3 text-center shadow-[0_6px_16px_-8px_rgba(37,99,255,0.25)] backdrop-blur-sm"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[var(--blue)] shadow-sm">
                  <Bot size={14} />
                </span>
                <span className="text-[0.68rem] font-semibold leading-tight text-[var(--blue-deep)] sm:text-[0.72rem]">
                  {agent.label}
                </span>
                <span className="hidden text-[0.6rem] font-medium text-[var(--navy-muted)] sm:block">
                  Agent
                </span>
              </motion.div>
            ))}
          </div>
        </div>

        <FlowArrow />

        {/* Shared state */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mx-auto flex w-full max-w-[240px] items-center justify-center gap-2 rounded-2xl border border-white/90 bg-white/90 px-4 py-3 text-sm font-semibold text-[var(--navy)] shadow-[0_10px_24px_-10px_rgba(37,99,255,0.3)] backdrop-blur-md"
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
        </motion.div>
      </div>
    </div>
  );
}
