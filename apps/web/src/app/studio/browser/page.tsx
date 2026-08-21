import type { Metadata } from "next";
import { connection } from "next/server";

import { StudioNavbar } from "@/components/demos/StudioNavbar";
import { BrowserInspectorClient } from "@/components/studio/BrowserInspectorClient";
import { loadStudioBrowserSnapshot } from "@/lib/studio/browser-events.server";

export const metadata: Metadata = {
  title: "Browser Inspector | Handoff Kit Studio",
  description: "Read-only Browser Real and research telemetry. Mock events are rejected.",
};

export default async function StudioBrowserPage() {
  await connection();
  const snapshot = await loadStudioBrowserSnapshot();
  return (
    <div className="min-h-dvh">
      <a href="#browser-content" className="security-skip-link">Skip to browser inspector</a>
      <StudioNavbar active="Browser" readOnly />
      <BrowserInspectorClient initialSnapshot={snapshot} />
    </div>
  );
}
