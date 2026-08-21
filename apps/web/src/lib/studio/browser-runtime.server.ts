import "server-only";

import { createHash } from "node:crypto";

import { emptyStudioBrowserSnapshot } from "./browser-events";

const CONTROL_ACTIONS = new Set(["pause", "resume", "cancel", "retry"]);
const MAX_SEQUENCE_SESSIONS = 1_024;
const ACTION_COMMAND = {
  pause: "session.pause",
  resume: "session.resume",
  cancel: "cancel",
  retry: "session.retry",
} as const;

export type StudioBrowserRuntimeKind = "tls" | "file-readonly" | "unconfigured";

export class StudioBrowserRuntimeAdapter {
  private readonly sequencesBySession = new Map<string, { next: () => number }>();
  private commandCounter = 0;

  private sequencesFor(sessionId: string) {
    const existing = this.sequencesBySession.get(sessionId);
    if (existing) return existing;
    let sequence = 0;
    const state = { next: () => { sequence += 1; return sequence; } };
    if (this.sequencesBySession.size >= MAX_SEQUENCE_SESSIONS) {
      const oldest = this.sequencesBySession.keys().next().value;
      if (typeof oldest === "string") this.sequencesBySession.delete(oldest);
    }
    this.sequencesBySession.set(sessionId, state);
    return state;
  }

  kind(): StudioBrowserRuntimeKind {
    if (process.env.HANDOFFKIT_BROWSER_REAL_CONFIG?.trim()) return "tls";
    if (process.env.HANDOFFKIT_STUDIO_BROWSER_EVENTS?.trim()) return "file-readonly";
    return "unconfigured";
  }

  controlsFor(status: string, connected: boolean) {
    if (!connected || this.kind() !== "tls") {
      return { pause: false, resume: false, cancel: false, retry: false };
    }
    if (status === "ready" || status === "running") {
      return { pause: true, resume: false, cancel: true, retry: false };
    }
    if (status === "paused") {
      return { pause: false, resume: true, cancel: true, retry: false };
    }
    if (status === "interrupted") {
      return { pause: false, resume: false, cancel: false, retry: true };
    }
    return { pause: false, resume: false, cancel: false, retry: false };
  }

  async dispatch(action: string, sessionId: string, expectedVersion = 0) {
    if (!CONTROL_ACTIONS.has(String(action ?? ""))) {
      return { ok: false, error_code: "invalid_request" };
    }
    if (this.kind() !== "tls") {
      return { ok: false, error_code: "studio_browser_control_unconfigured" };
    }
    if (!sessionId) {
      return { ok: false, error_code: "invalid_request" };
    }
    try {
      const {
        loadBrowserRealConfig,
        connectBrowserRealTls,
      } = await import("@handoffkit/browser-real");
      const { SecurityConfig, CertificateIdentityPolicy, CapabilityPolicy } = await import("@handoffkit/csp");
      const { NetworkConfig } = await import("@handoffkit/node");
      const config = loadBrowserRealConfig();
      const networkConfig = new NetworkConfig({
        securityConfig: new SecurityConfig({
          profile: "standard",
          requireMtls: true,
          trustDomain: config.trustDomain,
          caCertPath: config.caPath,
          certPath: config.certPath,
          keyPath: config.keyPath,
        }),
        identityPolicy: new CertificateIdentityPolicy({
          trustDomain: config.trustDomain,
          capabilitiesByFingerprint: config.grants,
        }),
        capabilityPolicy: new CapabilityPolicy({ allowedOperations: ["browser:control"] }),
      });
      const client = await connectBrowserRealTls({
        host: String(config.host),
        port: Number(config.port),
        networkConfig,
        sequences: this.sequencesFor(sessionId),
      });
      try {
        const event = await client.dispatch({
          command_id: `studio-${action}-${Date.now()}-${this.commandCounter += 1}`,
          session_id: sessionId,
          name: ACTION_COMMAND[action as keyof typeof ACTION_COMMAND],
          payload: { expected_version: expectedVersion },
        }) as { toWire?: () => unknown };
        return { ok: true, action, event: typeof event.toWire === "function" ? event.toWire() : event };
      } finally {
        await client.close().catch(() => {});
      }
    } catch (error) {
      return {
        ok: false,
        error_code: (error as { code?: string })?.code || "studio_browser_control_unavailable",
        error_details: {
          ...((error as { details?: Record<string, unknown> })?.details || {}),
          message: String((error as { message?: string })?.message || ""),
        },
      };
    }
  }
}

export function verifyAuthorizedScreenshot(page: {
  screenshot_authorized?: boolean;
  screenshot?: string;
  screenshot_sha256?: string;
  screenshot_bytes?: number;
} | null) {
  if (!page?.screenshot_authorized || typeof page.screenshot !== "string") return "";
  if (!page.screenshot.startsWith("data:image/png;base64,")) return "";
  const encoded = page.screenshot.slice("data:image/png;base64,".length);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > 512 * 1024) return "";
  if (typeof page.screenshot_bytes === "number" && page.screenshot_bytes !== bytes.byteLength) return "";
  if (!page.screenshot_sha256 || !/^[a-f0-9]{64}$/.test(page.screenshot_sha256)) return "";
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== page.screenshot_sha256) return "";
  return page.screenshot;
}

export function applyRuntimeControls(
  snapshot: ReturnType<typeof emptyStudioBrowserSnapshot>,
  adapter = new StudioBrowserRuntimeAdapter(),
) {
  const kind = adapter.kind();
  const connected = snapshot.source?.status === "connected" && kind === "tls";
  const status = String((snapshot as { session?: { status?: string } }).session?.status
    || snapshot.recovery?.checkpoint
    || "disconnected");
  snapshot.control_sink = { status: kind };
  snapshot.controls = adapter.controlsFor(status, connected);
  snapshot.runtime = { kind, connected };
  if (snapshot.page) {
    const verified = verifyAuthorizedScreenshot({
      screenshot_authorized: Boolean(snapshot.page.screenshot_authorized),
      screenshot: typeof snapshot.page.screenshot === "string" ? snapshot.page.screenshot : undefined,
      screenshot_sha256: typeof snapshot.page.screenshot_sha256 === "string" ? snapshot.page.screenshot_sha256 : undefined,
      screenshot_bytes: typeof snapshot.page.screenshot_bytes === "number" ? snapshot.page.screenshot_bytes : undefined,
    });
    snapshot.page = {
      ...snapshot.page,
      screenshot: verified,
      screenshot_authorized: Boolean(verified),
    };
  }
  return snapshot;
}
