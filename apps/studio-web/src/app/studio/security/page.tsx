import type { Metadata } from "next";
import { connection } from "next/server";

import { StudioNavbar } from "@/components/demos/StudioNavbar";
import { SecurityDashboardClient } from "@/components/studio/SecurityDashboardClient";
import { loadStudioSecuritySnapshot } from "@/lib/studio/security-events.server";

export const metadata: Metadata = {
  title: "Runtime Security | Handoff Kit Studio",
  description: "Read-only, validated runtime security visibility for Handoff Kit sessions and ML jobs.",
};

export default async function StudioSecurityPage() {
  await connection();
  const snapshot = await loadStudioSecuritySnapshot();
  return (
    <div className="min-h-dvh">
      <a href="#security-content" className="security-skip-link">Skip to runtime security content</a>
      <StudioNavbar active="Security" readOnly />
      <SecurityDashboardClient initialSnapshot={snapshot} />
    </div>
  );
}
