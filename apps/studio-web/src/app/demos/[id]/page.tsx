import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoDetailPage } from "@/components/demos/DemoDetailPage";
import { getAllDemoIds, getDemoById } from "@/lib/demo-data";

type PageProps = {
  params: Promise<{ id: string }>;
};

export function generateStaticParams() {
  return getAllDemoIds().map((id) => ({ id }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const demo = getDemoById(id);
  if (!demo) {
    return { title: "Demo not found — Handoff Kit Studio" };
  }
  return {
    title: `${demo.title} — Handoff Kit Studio`,
    description: demo.description,
  };
}

export default async function DemoPage({ params }: PageProps) {
  const { id } = await params;
  const demo = getDemoById(id);
  if (!demo) notFound();
  return <DemoDetailPage demo={demo} />;
}
