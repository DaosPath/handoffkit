"use client";

import Link from "next/link";
import { m } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import type { DemoItem } from "@/lib/demo-data";
import { MiniWorkflow } from "./MiniWorkflow";
import { fadeUp, stagger, viewportOnce } from "@/lib/motion";

const accentIcon: Record<DemoItem["accent"], string> = {
  blue: "bg-[rgba(37,99,255,0.12)] text-[#2563FF]",
  green: "bg-[rgba(16,185,129,0.12)] text-[#10B981]",
  purple: "bg-[rgba(139,92,246,0.12)] text-[#8B5CF6]",
  orange: "bg-[rgba(249,115,22,0.12)] text-[#F97316]",
};

type DemoCardProps = {
  demo: DemoItem;
  index: number;
  onSelect: (id: string) => void;
  selected?: boolean;
};

export function DemoCard({ demo, index, onSelect, selected }: DemoCardProps) {
  return (
    <m.article
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={viewportOnce}
      transition={stagger(index, 0.05)}
      className={`liquid-card flex h-full flex-col p-5 sm:p-6 ${
        demo.featured ? "demo-card-featured" : ""
      } ${selected ? "ring-2 ring-[rgba(37,99,255,0.25)]" : ""}`}
    >
      <div className="relative z-10 flex h-full flex-col">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-2xl ${accentIcon[demo.accent]}`}
          >
            <Sparkles size={18} />
          </div>
          {demo.featured && (
            <span className="rounded-full bg-gradient-to-r from-[#2563FF] to-[#60A5FA] px-2.5 py-0.5 text-[0.65rem] font-bold tracking-wide text-white shadow-[0_6px_14px_-4px_rgba(37,99,255,0.5)]">
              Featured
            </span>
          )}
        </div>

        <h3 className="text-base font-bold tracking-tight text-[var(--navy)] sm:text-lg">
          {demo.title}
        </h3>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--navy-muted)]">
          {demo.description}
        </p>

        <div className="my-4 rounded-2xl border border-[rgba(37,99,255,0.1)] bg-white/50 p-3">
          <MiniWorkflow kind={demo.workflowKind} />
        </div>

        <div className="mb-4 flex flex-wrap gap-1.5">
          {demo.tags.map((tag) => (
            <span key={tag.label} className={`tag-pill tag-pill-${tag.tone}`}>
              {tag.label}
            </span>
          ))}
        </div>

        <div className="mt-auto flex flex-col gap-2">
          <Link
            href={`/demos/${demo.id}`}
            className="liquid-button w-full !text-sm"
          >
            View Full Demo
            <ArrowRight size={15} />
          </Link>
          <button
            type="button"
            onClick={() => onSelect(demo.id)}
            className="liquid-button-secondary w-full !text-sm"
          >
            Preview on page
          </button>
        </div>
      </div>
    </m.article>
  );
}
