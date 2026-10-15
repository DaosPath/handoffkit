"use client";

import { m } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { GitHubIcon } from "./icons";
import { easeOut, fadeUp, viewportOnce } from "@/lib/motion";

export function CTA() {
  return (
    <section id="get-started" className="relative px-4 py-16 sm:px-6 sm:py-24">
      <m.div
        variants={fadeUp}
        initial="hidden"
        whileInView="show"
        viewport={viewportOnce}
        transition={easeOut}
        className="liquid-surface-intense relative mx-auto max-w-6xl overflow-hidden px-6 py-14 text-center sm:px-12 sm:py-20"
      >
        {/* Liquid intensity blobs */}
        <div className="liquid-blob liquid-blob-white absolute -left-16 -top-20 h-56 w-56 opacity-40" />
        <div
          className="liquid-blob absolute -bottom-24 -right-10 h-64 w-64 opacity-50"
          style={{
            background:
              "radial-gradient(circle, rgba(147,197,253,0.7), rgba(37,99,255,0.2) 60%, transparent 75%)",
            animationDelay: "-3s",
          }}
        />
        <span
          className="liquid-bubble left-[15%] top-[30%] h-4 w-4 opacity-60"
          style={{ animationDelay: "0.5s" }}
        />
        <span
          className="liquid-bubble bottom-[25%] right-[20%] h-3 w-3 opacity-50"
          style={{ animationDelay: "1.8s" }}
        />
        <span
          className="liquid-bubble right-[12%] top-[20%] h-2 w-2 opacity-70"
          style={{ animationDelay: "1s" }}
        />

        <div className="relative z-10">
          <h2 className="text-[clamp(1.75rem,4vw,2.75rem)] font-extrabold tracking-[-0.035em] text-white">
            Ship reliable agent systems, faster
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-blue-100/90 sm:text-lg">
            Build observable, replayable, and auditable AI workflows with
            structured handoffs.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href="/docs/quick-start"
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-[var(--blue-deep)] shadow-[0_8px_28px_-6px_rgba(7,20,47,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-6px_rgba(7,20,47,0.4)]"
            >
              Get Started
              <ArrowRight size={16} strokeWidth={2.25} />
            </a>
            <a
              href="https://github.com/DaosPath/handoffkit"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-white/20"
            >
              <GitHubIcon size={16} />
              View on GitHub
            </a>
          </div>
        </div>
      </m.div>
    </section>
  );
}
