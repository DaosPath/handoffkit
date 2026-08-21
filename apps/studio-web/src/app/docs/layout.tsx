import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Documentation — Handoff Kit",
    template: "%s — Handoff Kit Docs",
  },
  description:
    "Documentation for Handoff Kit: structured handoffs, shared state, routing, replay, audit trails, and multi-runtime agent workflows.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
