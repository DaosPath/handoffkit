"use client";

import {
  CircleCheck,
  CircleX,
  Database,
  Gauge,
  KeyRound,
  Network,
  PackageCheck,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import {
  markStudioSecurityDisconnected,
  type StudioSecuritySnapshot,
  type StudioSourceStatus,
} from "@/lib/studio/security-events";

const utcFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "UTC",
});

function formatUtc(value: string | null) {
  return value ? `${utcFormatter.format(new Date(value))} UTC` : "Not reported";
}

function sourceLabel(status: StudioSourceStatus) {
  return {
    connected: "Connected",
    unconfigured: "Not configured",
    invalid: "Source rejected",
    disconnected: "Refresh disconnected",
  }[status];
}

function StatusPill({ tone, children }: { tone: "ok" | "warn" | "danger" | "neutral"; children: ReactNode }) {
  return <span className={`security-pill security-pill-${tone}`}>{children}</span>;
}

function MetricCard({ icon, label, value, detail }: {
  icon: ReactNode;
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <article className="security-metric-card">
      <span className="security-metric-icon" aria-hidden="true">{icon}</span>
      <div>
        <p className="security-eyebrow">{label}</p>
        <p className="security-metric-value">{value}</p>
        <p className="security-muted">{detail}</p>
      </div>
    </article>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="security-empty" role="status">
      <Database size={22} aria-hidden="true" />
      <div>
        <p className="font-semibold text-[var(--navy)]">{title}</p>
        <p className="security-muted mt-1">{detail}</p>
      </div>
    </div>
  );
}

function validSnapshot(value: unknown): value is StudioSecuritySnapshot {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<StudioSecuritySnapshot>;
  return data.format === "handoffkit.studio.security-snapshot"
    && data.format_version === 1
    && Array.isArray(data.sessions)
    && Array.isArray(data.jobs)
    && Array.isArray(data.artifacts)
    && Array.isArray(data.errors)
    && Boolean(data.source && data.metrics);
}

export function SecurityDashboardClient({ initialSnapshot }: { initialSnapshot: StudioSecuritySnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/studio/security", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("runtime snapshot request failed");
      const next: unknown = await response.json();
      if (!validSnapshot(next)) throw new Error("runtime snapshot is invalid");
      setSnapshot(next);
    } catch {
      setSnapshot((current) => markStudioSecurityDisconnected(current));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const interval = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const queuePercent = Math.round(
    (snapshot.metrics.queue.pending / snapshot.metrics.queue.capacity) * 100,
  );
  const sourceTone = snapshot.source.status === "connected"
    ? "ok"
    : snapshot.source.status === "unconfigured"
      ? "neutral"
      : "danger";

  return (
    <main id="security-content" className="security-shell" tabIndex={-1}>
      <section className="security-hero" aria-labelledby="security-title">
        <div className="security-hero-copy">
          <p className="security-kicker"><ShieldCheck size={16} aria-hidden="true" /> Runtime security</p>
          <h1 id="security-title">Authenticated operations, without inferred state.</h1>
          <p>
            This read-only view renders only validated runtime events. Empty or rejected sources stay explicit;
            Studio never creates sample sessions, identities, or verification results.
          </p>
        </div>
        <div className="security-source-panel" aria-live="polite">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="security-eyebrow">Event source</p>
              <div className="mt-2"><StatusPill tone={sourceTone}>{sourceLabel(snapshot.source.status)}</StatusPill></div>
            </div>
            <button
              type="button"
              className="security-refresh-button"
              onClick={refresh}
              disabled={refreshing}
            >
              <RefreshCw size={16} className={refreshing ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden="true" />
              {refreshing ? "Refreshing" : "Refresh"}
            </button>
          </div>
          <dl className="security-source-meta">
            <div><dt>Validated events</dt><dd>{snapshot.source.event_count}</dd></div>
            <div><dt>Last event</dt><dd>{formatUtc(snapshot.source.last_event_at)}</dd></div>
            <div><dt>Snapshot</dt><dd>{formatUtc(snapshot.generated_at)}</dd></div>
          </dl>
        </div>
      </section>

      {snapshot.source.status !== "connected" && (
        <section className={`security-notice security-notice-${sourceTone}`} role="status">
          {snapshot.source.status === "unconfigured" ? <Network aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
          <div>
            <h2>{sourceLabel(snapshot.source.status)}</h2>
            <p>
              {snapshot.source.status === "unconfigured"
                ? "Configure HANDOFFKIT_STUDIO_SECURITY_EVENTS on the Studio server to a private runtime event file. No placeholder data is shown."
                : snapshot.source.status === "disconnected"
                  ? "The last validated snapshot remains visible, but live refresh is unavailable."
                  : `The runtime event source failed validation (${snapshot.source.error_code ?? "unknown"}). Data was withheld.`}
            </p>
          </div>
        </section>
      )}

      <section className="security-metrics" aria-label="Runtime security metrics">
        <MetricCard
          icon={<Network size={20} />}
          label="Connections"
          value={`${snapshot.metrics.connections}/${snapshot.metrics.connection_limit}`}
          detail={`${snapshot.sessions.length} authenticated session${snapshot.sessions.length === 1 ? "" : "s"}`}
        />
        <MetricCard
          icon={<ShieldAlert size={20} />}
          label="Replay rejections"
          value={snapshot.metrics.replay_rejections}
          detail="Cryptographic replay checks"
        />
        <MetricCard
          icon={<KeyRound size={20} />}
          label="Authorization rejections"
          value={snapshot.metrics.authorization_rejections}
          detail="Local capability policy"
        />
        <MetricCard
          icon={<Gauge size={20} />}
          label="Queue pressure"
          value={`${queuePercent}%`}
          detail={`${snapshot.metrics.queue.pending} of ${snapshot.metrics.queue.capacity} pending`}
        />
      </section>

      <section className="security-section" aria-labelledby="sessions-title">
        <div className="security-section-heading">
          <div>
            <p className="security-eyebrow">Transport evidence</p>
            <h2 id="sessions-title">Authenticated sessions</h2>
          </div>
          <StatusPill tone="neutral">Certificate identity only</StatusPill>
        </div>
        {snapshot.sessions.length === 0 ? (
          <EmptyState title="No authenticated sessions observed" detail="Waiting for validated runtime events; no demo session is substituted." />
        ) : (
          <div className="security-table-wrap" tabIndex={0} aria-label="Scrollable authenticated sessions table">
            <table className="security-table">
              <thead>
                <tr>
                  <th>Identity</th>
                  <th>Certificate</th>
                  <th>Transport</th>
                  <th>Policy</th>
                  <th>Runtime</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.sessions.map((session) => (
                  <tr key={session.session_id}>
                    <td>
                      <strong>{session.peer_id}</strong>
                      <span>{session.node_id}{session.worker_id ? ` / ${session.worker_id}` : ""}</span>
                      <span>{session.trust_domain}</span>
                      <StatusPill tone="ok">Certificate SAN · authenticated</StatusPill>
                    </td>
                    <td>
                      <code>{session.credential_fingerprint}</code>
                      <span>{formatUtc(session.certificate_expires_at)}</span>
                      <StatusPill tone={session.certificate_state === "valid" ? "ok" : "danger"}>
                        {session.certificate_state === "valid" ? <CircleCheck size={13} aria-hidden="true" /> : <CircleX size={13} aria-hidden="true" />}
                        {session.certificate_state}
                      </StatusPill>
                    </td>
                    <td>
                      <strong>{session.security_profile}</strong>
                      <span>{session.tls_version}</span>
                      <span>Group: {session.negotiated_group ?? "not exposed"}</span>
                      <span>PQ provider: {session.hybrid_pq_provider_state}</span>
                    </td>
                    <td>
                      <span>Revocation: {session.revocation_state}</span>
                      <span>Rotation: {session.rotation.status}</span>
                      <span>Replay blocked: {session.replay_rejections}</span>
                      <span>Authorization blocked: {session.authorization_rejections}</span>
                    </td>
                    <td>
                      <strong>{session.runtime}</strong>
                      <span>{session.edge_profile}</span>
                      <span>Reconnects: {session.reconnects}</span>
                      <span>Queue: {session.queue.pending}/{session.queue.capacity}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="security-two-column">
        <section className="security-section" aria-labelledby="jobs-title">
          <div className="security-section-heading">
            <div><p className="security-eyebrow">Compute</p><h2 id="jobs-title">Jobs and progress</h2></div>
          </div>
          {snapshot.jobs.length === 0 ? (
            <EmptyState title="No runtime jobs" detail="Training and evaluation updates appear only after a worker reports them." />
          ) : (
            <ul className="security-list">
              {snapshot.jobs.map((job) => (
                <li key={job.job_id}>
                  <div className="security-list-heading">
                    <div><strong>{job.job_id}</strong><span>{job.operation} · {job.runtime}</span></div>
                    <StatusPill tone={job.status === "completed" ? "ok" : job.status === "failed" ? "danger" : "warn"}>{job.status}</StatusPill>
                  </div>
                  <div className="security-progress" role="progressbar" aria-label={`${job.job_id} progress`} aria-valuenow={Math.round(job.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <span style={{ width: `${job.progress * 100}%` }} />
                  </div>
                  <p className="security-muted">{Math.round(job.progress * 100)}% · {job.worker_id ?? "worker not reported"} · {formatUtc(job.updated_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="security-section" aria-labelledby="artifacts-title">
          <div className="security-section-heading">
            <div><p className="security-eyebrow">Artifact gate</p><h2 id="artifacts-title">Verification results</h2></div>
          </div>
          {snapshot.artifacts.length === 0 ? (
            <EmptyState title="No artifact decisions" detail="Only completed runtime verification decisions are rendered." />
          ) : (
            <ul className="security-list">
              {snapshot.artifacts.map((artifact) => (
                <li key={artifact.artifact_id}>
                  <div className="security-list-heading">
                    <div><strong>{artifact.artifact_id}</strong><span>{artifact.media_type}</span></div>
                    <StatusPill tone={artifact.verification === "verified" ? "ok" : "danger"}>
                      {artifact.verification === "verified" ? <PackageCheck size={13} aria-hidden="true" /> : <CircleX size={13} aria-hidden="true" />}
                      {artifact.verification}
                    </StatusPill>
                  </div>
                  <p className="security-muted">
                    Producer: {artifact.producer_identity ?? "not trusted"} · {artifact.identity_source}
                  </p>
                  <p className="security-muted">
                    Signer: {artifact.signer_fingerprint ?? "not verified"}
                    {artifact.error_code ? ` · ${artifact.error_code}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="security-section" aria-labelledby="errors-title">
        <div className="security-section-heading">
          <div><p className="security-eyebrow">Sanitized runtime errors</p><h2 id="errors-title">Recent rejections</h2></div>
          <span className="security-muted">Latest {Math.min(snapshot.errors.length, 50)} of 50 retained</span>
        </div>
        {snapshot.errors.length === 0 ? (
          <EmptyState title="No security rejections" detail="No validated rejection event is present in the configured source." />
        ) : (
          <ul className="security-error-list">
            {snapshot.errors.map((error, index) => (
              <li key={`${error.observed_at}-${error.code}-${index}`}>
                <ShieldAlert size={18} aria-hidden="true" />
                <div><strong>{error.code}</strong><p>{error.message}</p></div>
                <div><span>{error.category}</span><time dateTime={error.observed_at}>{formatUtc(error.observed_at)}</time></div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
