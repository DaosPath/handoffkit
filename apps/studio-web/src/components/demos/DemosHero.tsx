"use client";

import { m } from "framer-motion";
import { heroStats } from "@/lib/demo-data";
import { easeOut, fadeRight, fadeUp } from "@/lib/motion";

export function DemosHero() {
  return (
    <section className="relative overflow-hidden px-4 pb-10 pt-12 sm:px-6 sm:pb-14 sm:pt-16">
      <div className="liquid-blob liquid-blob-blue absolute -left-24 top-0 h-72 w-72 opacity-40" />
      <div
        className="liquid-blob liquid-blob-soft absolute -right-16 top-24 h-80 w-80 opacity-45"
        style={{ animationDelay: "-4s" }}
      />
      <span className="liquid-bubble left-[12%] top-[30%] h-3 w-3" />
      <span
        className="liquid-bubble right-[28%] top-[22%] h-2 w-2"
        style={{ animationDelay: "1s" }}
      />

      <div className="relative z-10 mx-auto grid max-w-[1400px] items-center gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-14">
        <m.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          transition={easeOut}
        >
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[rgba(37,99,255,0.16)] bg-white/75 px-3.5 py-1.5 text-xs font-semibold text-[var(--blue)] shadow-[0_1px_0_rgba(255,255,255,0.9)_inset]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--blue)] shadow-[0_0_8px_rgba(37,99,255,0.7)]" />
            Replayable. Auditable. Structured handoffs.
          </div>
          <h1 className="text-[clamp(2rem,4.5vw,3.15rem)] font-extrabold leading-[1.08] tracking-[-0.04em] text-[var(--navy)]">
            Explore interactive
            <br />
            <span className="bg-gradient-to-r from-[var(--blue)] to-[#60A5FA] bg-clip-text text-transparent">
              agent demos
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-[var(--navy-muted)] sm:text-lg">
            Replay multi-agent workflows, compare models, and inspect every
            handoff.
          </p>
        </m.div>

        <m.div
          variants={fadeRight}
          initial="hidden"
          animate="show"
          transition={{ ...easeOut, delay: 0.08 }}
          className="liquid-shell p-5 sm:p-6"
        >
          <div className="relative z-10">
            <p className="mb-4 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-[var(--navy-muted)]">
              Studio snapshot
              <span className="ml-2 font-medium normal-case tracking-normal text-[var(--navy-muted)]/80">
                (mock data)
              </span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              {heroStats.map((stat) => (
                <div
                  key={stat.label}
                  className="liquid-card !rounded-2xl p-3.5"
                  title={stat.hint}
                >
                  <div className="relative z-10">
                    <p className="text-xl font-extrabold tracking-tight text-[var(--navy)] sm:text-2xl">
                      {stat.value}
                    </p>
                    <p className="mt-0.5 text-xs font-medium text-[var(--navy-muted)]">
                      {stat.label}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </m.div>
      </div>
    </section>
  );
}
