"use client";

import { m } from "framer-motion";
import { Boxes, Code2, PlayCircle, ShieldCheck } from "lucide-react";
import { easeOut, fadeUp, viewportOnce } from "@/lib/motion";

/** Editable trust items — keep as labels, not fabricated metrics. */
const trustItems = [
  {
    icon: Boxes,
    label: "Open source",
    detail: "MIT licensed",
  },
  {
    icon: Code2,
    label: "Typed SDK",
    detail: "First-class types",
  },
  {
    icon: PlayCircle,
    label: "Replayable runs",
    detail: "Deterministic debug",
  },
  {
    icon: ShieldCheck,
    label: "Production-ready workflows",
    detail: "Audit-friendly",
  },
] as const;

export function TrustStrip() {
  return (
    <section className="relative px-4 pb-8 sm:px-6 sm:pb-12">
      <m.div
        variants={fadeUp}
        initial="hidden"
        whileInView="show"
        viewport={viewportOnce}
        transition={easeOut}
        className="liquid-card mx-auto max-w-6xl px-4 py-5 sm:px-8 sm:py-6"
      >
        <div className="relative z-10 grid grid-cols-2 gap-6 md:grid-cols-4 md:gap-4">
          {trustItems.map((item) => (
            <div
              key={item.label}
              className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[rgba(37,99,255,0.1)] text-[var(--blue)]">
                <item.icon size={18} strokeWidth={2} />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--navy)]">{item.label}</p>
                <p className="text-xs text-[var(--navy-muted)]">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </m.div>
    </section>
  );
}
