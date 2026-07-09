import type { Metadata } from "next";
import { DemosPageClient } from "@/components/demos/DemosPageClient";

export const metadata: Metadata = {
  title: "Handoff Kit Studio — Interactive Agent Demos",
  description:
    "Explore interactive multi-agent demos in Handoff Kit Studio. Replay workflows, inspect handoffs, and review run summaries.",
};

export default function DemosPage() {
  return <DemosPageClient />;
}
