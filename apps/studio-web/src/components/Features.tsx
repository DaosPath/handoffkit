"use client";

import { m } from "framer-motion";
import {
  Database,
  GitBranch,
  History,
  ScrollText,
  Puzzle,
  Sparkles,
} from "lucide-react";
import { fadeUp, stagger, viewportOnce } from "@/lib/motion";

const features = [
  {
    icon: Database,
    title: "Structured State",
    description: "Define a shared schema that every agent can read and write.",
  },
  {
    icon: GitBranch,
    title: "Routing",
    description: "Intelligent routing policies guide work to the right agent.",
  },
  {
    icon: History,
    title: "Replay",
    description: "Deterministic replays for debugging and evaluations.",
  },
  {
    icon: ScrollText,
    title: "Auditability",
    description: "Full event logs and explainable handoff trails.",
  },
  {
    icon: Puzzle,
    title: "Integrations",
    description: "Works with your stack. Connect tools, data, and models.",
  },
  {
    icon: Sparkles,
    title: "Developer Experience",
    description: "Type-safe SDK, great DX, and comprehensive docs.",
  },
];

export function Features() {
  return (
    <section id="features" className="relative px-4 py-20 sm:px-6 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center sm:mb-16">
          <p className="section-label justify-center">Everything you need</p>
          <h2 className="section-title">Built for complex agent systems</h2>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, i) => (
            <m.article
              key={feature.title}
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              viewport={viewportOnce}
              transition={stagger(i)}
              className="liquid-card group p-6 sm:p-7"
            >
              <div className="relative z-10">
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(37,99,255,0.1)] text-[var(--blue)] shadow-[0_0_0_1px_rgba(37,99,255,0.12)] transition-shadow group-hover:shadow-[0_0_24px_rgba(37,99,255,0.25)]">
                  <feature.icon size={20} strokeWidth={2} />
                </div>
                <h3 className="mb-2 text-lg font-semibold tracking-tight text-[var(--navy)]">
                  {feature.title}
                </h3>
                <p className="text-sm leading-relaxed text-[var(--navy-muted)]">
                  {feature.description}
                </p>
              </div>
            </m.article>
          ))}
        </div>
      </div>
    </section>
  );
}
