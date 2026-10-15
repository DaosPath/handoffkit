"use client";

import { m } from "framer-motion";
import {
  Code2,
  Search,
  Headphones,
  FlaskConical,
  Workflow,
} from "lucide-react";
import { fadeUp, stagger, viewportOnce } from "@/lib/motion";

const useCases = [
  {
    icon: Code2,
    title: "Coding Agents",
    description:
      "Plan, code, test, and review with specialized engineering agents.",
  },
  {
    icon: Search,
    title: "Research Workflows",
    description:
      "Decompose questions, gather sources, and synthesize findings.",
  },
  {
    icon: Headphones,
    title: "Support Triage",
    description: "Route issues, gather context, and resolve faster.",
  },
  {
    icon: FlaskConical,
    title: "Evaluations",
    description: "Run evals, collect metrics, and iterate with confidence.",
  },
  {
    icon: Workflow,
    title: "Multi-Agent Pipelines",
    description: "Chain agents into powerful, reliable pipelines.",
  },
];

export function UseCases() {
  return (
    <section id="use-cases" className="relative px-4 py-20 sm:px-6 sm:py-28">
      <div className="liquid-blob liquid-blob-soft absolute right-0 top-20 h-64 w-64 opacity-30" />

      <div className="relative z-10 mx-auto max-w-6xl">
        <div className="mb-12 text-center sm:mb-16">
          <p className="section-label justify-center">Flexible by design</p>
          <h2 className="section-title">
            Use Handoff Kit anywhere agents work
          </h2>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {useCases.map((item, i) => (
            <m.article
              key={item.title}
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              viewport={viewportOnce}
              transition={stagger(i)}
              className={`liquid-card p-6 sm:p-7 ${
                i === 4 ? "sm:col-span-2 lg:col-span-1" : ""
              }`}
            >
              <div className="relative z-10">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(37,99,255,0.1)] text-[var(--blue)]">
                  <item.icon size={18} />
                </div>
                <h3 className="mb-2 text-base font-semibold text-[var(--navy)]">
                  {item.title}
                </h3>
                <p className="mt-0 text-sm leading-relaxed text-[var(--navy-muted)]">
                  {item.description}
                </p>
              </div>
            </m.article>
          ))}
        </div>
      </div>
    </section>
  );
}
