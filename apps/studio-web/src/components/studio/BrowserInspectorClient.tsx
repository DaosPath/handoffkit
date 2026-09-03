"use client";

import { Database, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { markStudioBrowserDisconnected } from "@/lib/studio/browser-events";

function validSnapshot(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const data = value as { format?: string; format_version?: number; timeline?: unknown };
  return data.format === "handoffkit.studio.browser-snapshot"
    && data.format_version === 1
    && Array.isArray(data.timeline);
}

export function BrowserInspectorClient({ initialSnapshot }: { initialSnapshot: Record<string, unknown> }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [controlError, setControlError] = useState("");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/studio/browser", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("runtime snapshot request failed");
      const next: unknown = await response.json();
      if (!validSnapshot(next)) throw new Error("runtime snapshot is invalid");
      setSnapshot(next);
    } catch {
      setSnapshot((current) => markStudioBrowserDisconnected(current as never) as Record<string, unknown>);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const sendControl = useCallback(async (action: "pause" | "resume" | "cancel" | "retry") => {
    setControlError("");
    const session = snapshot.session as { session_id?: string; version?: number } | undefined;
    try {
      const response = await fetch("/api/studio/browser", {
        method: "POST",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          session_id: session?.session_id || "",
          expected_version: session?.version || 0,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== "object" || (payload as { ok?: boolean }).ok !== true) {
        const code = payload && typeof payload === "object"
          ? String((payload as { error_code?: string }).error_code || "studio_browser_control_unconfigured")
          : "studio_browser_control_unconfigured";
        setControlError(code);
        return;
      }
      await refresh();
    } catch {
      setControlError("studio_browser_control_unconfigured");
    }
  }, [refresh, snapshot.session]);

  useEffect(() => {
    const interval = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const source = snapshot.source as { status?: string; error_code?: string } | undefined;
  const plan = snapshot.plan as { providers?: string[]; search_plan?: string } | null;
  const page = snapshot.page as {
    url?: string;
    title?: string;
    screenshot_authorized?: boolean;
    screenshot?: string;
  } | null;
  const stages = Array.isArray(snapshot.stages) ? snapshot.stages as Array<{ stage: string; message: string }> : [];
  const errors = Array.isArray(snapshot.errors) ? snapshot.errors as Array<{ code: string; message: string }> : [];
  const claims = Array.isArray(snapshot.claims) ? snapshot.claims as Array<{ claim_id: string; status: string; statement: string }> : [];
  const timeline = Array.isArray(snapshot.timeline) ? snapshot.timeline as Array<{ event_type: string; message: string; occurred_at: string }> : [];
  const permissions = Array.isArray(snapshot.permissions) ? snapshot.permissions as string[] : [];
  const profile = snapshot.profile as { kind?: string; persistent?: boolean } | undefined;
  const index = snapshot.index as { enabled?: boolean; backend?: string } | undefined;
  const recovery = snapshot.recovery as { delivery?: string; checkpoint?: string } | undefined;
  const controls = snapshot.controls as Record<string, boolean> | undefined;
  const runtime = snapshot.runtime as { kind?: string; connected?: boolean } | undefined;
  const session = snapshot.session as { session_id?: string; status?: string } | undefined;
  const liveMessage = controlError
    ? `Control failed: ${controlError}`
    : refreshing
      ? "Refreshing browser runtime"
      : runtime?.connected
        ? `Connected session ${session?.status || "ready"}`
        : "Browser Real is disconnected. Controls are disabled.";

  return (
    <main id="browser-content" className="security-shell browser-inspector" tabIndex={-1}>
      <section className="security-hero">
        <div className="security-hero-copy">
          <p className="security-kicker">HandoffKit 1.20</p>
          <h1>Browser Inspector</h1>
          <p>
            Read-only view of real Browser events. Unconfigured sources stay empty.
            Mock or synthetic telemetry is rejected.
          </p>
        </div>
        <aside className="security-source-panel">
          <p className="security-eyebrow">Event source</p>
          <p className="security-metric-value">{source?.status ?? "unconfigured"}</p>
          <p className="security-muted">{source?.error_code || "HANDOFFKIT_STUDIO_BROWSER_EVENTS"}</p>
          <button
            type="button"
            className="browser-inspector-btn"
            onClick={refresh}
            disabled={refreshing}
          >
            <RefreshCw size={16} aria-hidden="true" />
            Refresh
          </button>
        </aside>
      </section>

      <section className="security-section" aria-labelledby="browser-plan">
        <h2 id="browser-plan">Plan and providers</h2>
        {plan ? (
          <p>{plan.search_plan || "custom"}: {(plan.providers || []).join(" → ") || "none recorded"}</p>
        ) : (
          <div className="security-empty" role="status">
            <Database size={22} aria-hidden="true" />
            <p>No plan event has been recorded.</p>
          </div>
        )}
      </section>

      <section className="security-section" aria-labelledby="browser-progress">
        <h2 id="browser-progress">Progress</h2>
        {stages.length ? (
          <ol className="browser-inspector-list">
            {stages.map((stage, index) => (
              <li key={`${stage.stage}-${index}`}>{stage.stage}: {stage.message}</li>
            ))}
          </ol>
        ) : <p className="security-muted">No stage events.</p>}
      </section>

      <section className="security-section" aria-labelledby="browser-page">
        <h2 id="browser-page">Current page</h2>
        {page ? (
          <>
            <p>
              {page.title || "Untitled"} — {page.url || "no URL"}
              {page.screenshot_authorized ? " (screenshot authorized)" : " (no screenshot)"}
            </p>
            {page.screenshot_authorized
              && typeof page.screenshot === "string"
              && page.screenshot.startsWith("data:image/") ? (
                <img
                  className="browser-inspector-screenshot"
                  src={page.screenshot}
                  alt={`Authorized screenshot of ${page.url || "current page"}`}
                />
              ) : null}
          </>
        ) : <p className="security-muted">No page event.</p>}
      </section>

      <section className="security-section" aria-labelledby="browser-permissions">
        <h2 id="browser-permissions">Permissions</h2>
        <p>{permissions.length ? permissions.join(", ") : "None recorded"}</p>
      </section>

      <section className="security-section" aria-labelledby="browser-errors">
        <h2 id="browser-errors">Errors</h2>
        {errors.length ? (
          <ul className="security-error-list">
            {errors.map((error) => (
              <li key={error.code}>
                <TriangleAlert size={16} aria-hidden="true" />
                <strong>{error.code}</strong>
                <p>{error.message}</p>
              </li>
            ))}
          </ul>
        ) : <p className="security-muted">No errors.</p>}
      </section>

      <section className="security-section" aria-labelledby="browser-claims">
        <h2 id="browser-claims">Claims and contradictions</h2>
        {claims.length ? (
          <ul className="browser-inspector-list">
            {claims.map((claim) => (
              <li key={claim.claim_id}>{claim.status}: {claim.statement}</li>
            ))}
          </ul>
        ) : <p className="security-muted">No claims recorded.</p>}
      </section>

      <section className="security-section" aria-labelledby="browser-meta">
        <h2 id="browser-meta">Profile, index, recovery</h2>
        <p>Profile: {profile?.kind || "unknown"} {profile?.persistent ? "(persistent opt-in)" : "(ephemeral)"}</p>
        <p>Index: {index?.enabled ? index.backend : "disabled"} — not a complete Internet index.</p>
        <p>Recovery: {recovery?.delivery || "at_least_once"} {recovery?.checkpoint ? `checkpoint ${recovery.checkpoint}` : ""}</p>
        <p>Controls recorded: pause={String(Boolean(controls?.pause))} resume={String(Boolean(controls?.resume))} cancel={String(Boolean(controls?.cancel))} retry={String(Boolean(controls?.retry))}</p>
        <p>Runtime: {runtime?.kind || "unconfigured"} {runtime?.connected ? "(connected)" : "(disconnected)"}</p>
        <p>Session: {session?.session_id || "none"} ({session?.status || "disconnected"})</p>
        <div className="browser-inspector-controls" role="group" aria-label="Browser session controls">
          <button type="button" className="browser-inspector-btn" onClick={() => sendControl("pause")} disabled={!controls?.pause}>Pause</button>
          <button type="button" className="browser-inspector-btn" onClick={() => sendControl("resume")} disabled={!controls?.resume}>Resume</button>
          <button type="button" className="browser-inspector-btn" onClick={() => sendControl("cancel")} disabled={!controls?.cancel}>Cancel</button>
          <button type="button" className="browser-inspector-btn" onClick={() => sendControl("retry")} disabled={!controls?.retry}>Retry</button>
        </div>
        <p className="security-muted" role="status" aria-live="polite">
          {liveMessage}
        </p>
      </section>

      <section className="security-section" aria-labelledby="browser-timeline">
        <h2 id="browser-timeline">Timeline</h2>
        {timeline.length ? (
          <ol className="browser-inspector-list">
            {timeline.map((item) => (
              <li key={`${item.event_type}-${item.occurred_at}`}>{item.occurred_at} {item.event_type}: {item.message}</li>
            ))}
          </ol>
        ) : <p className="security-muted">No events. This inspector never invents telemetry.</p>}
      </section>
    </main>
  );
}
