"use client";

import { m } from "framer-motion";
import { ArrowRight, BookOpen } from "lucide-react";
import { HeroDiagram } from "./HeroDiagram";
import { easeOut, fadeRight, fadeUp } from "@/lib/motion";

const chips = [
  "Open source / MIT licensed",
  "Production ready / Battle tested",
  "Developer first / Built for speed",
];

export function Hero() {
  return (
    <section className="relative overflow-hidden px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-20">
      {/* Ambient blobs */}
      <div className="liquid-blob liquid-blob-blue absolute -left-24 top-10 h-72 w-72 opacity-40" />
      <div
        className="liquid-blob liquid-blob-soft absolute -right-20 top-40 h-80 w-80 opacity-50"
        style={{ animationDelay: "-5s" }}
      />

      <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <m.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          transition={easeOut}
        >
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[rgba(37,99,255,0.18)] bg-white/70 px-3.5 py-1.5 text-xs font-semibold text-[var(--blue)] shadow-[0_1px_0_rgba(255,255,255,0.9)_inset] backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--blue)] shadow-[0_0_8px_rgba(37,99,255,0.7)]" />
            Orchestrate AI Agents with Confidence
          </div>

          <h1 className="text-[clamp(2.25rem,5vw,3.5rem)] font-extrabold leading-[1.08] tracking-[-0.04em] text-[var(--navy)]">
            Structured handoffs
            <br />
            <span className="bg-gradient-to-r from-[var(--blue)] to-[#60a5fa] bg-clip-text text-transparent">
              for reliable AI systems
            </span>
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-[var(--navy-muted)] sm:text-lg">
            Handoff Kit gives your agents a shared state, clear routing, and
            verifiable handoffs. Build complex workflows that are observable,
            debuggable, and production-ready.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href="/docs/quick-start" className="btn-primary">
              Get Started
              <ArrowRight size={16} strokeWidth={2.25} />
            </a>
            <a href="/docs" className="btn-secondary">
              <BookOpen size={16} />
              Read the Docs
            </a>
          </div>

          <div className="mt-8 flex flex-wrap gap-2">
            {chips.map((chip) => (
              <span key={chip} className="chip">
                <span className="chip-dot" />
                {chip}
              </span>
            ))}
          </div>
        </m.div>

        <m.div
          variants={fadeRight}
          initial="hidden"
          animate="show"
          transition={{ ...easeOut, delay: 0.1 }}
          className="relative"
        >
          <HeroDiagram />
        </m.div>
      </div>
    </section>
  );
}
