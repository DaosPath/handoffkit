import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoDetailPage } from "@/components/demos/DemoDetailPage";
import { getDemoById } from "@/lib/demo-data";

export const metadata: Metadata = {
  title: "Clinical Sequential Reasoning Lab — Handoff Kit Studio",
  description:
    "Experimental sequential diagnosis lab for research and education. Not clinically validated.",
};

export default function ClinicalLabPage() {
  const demo = getDemoById("clinical-lab");
  if (!demo) notFound();
  return <DemoDetailPage demo={demo} />;
}
