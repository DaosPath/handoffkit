import { BrowserCommand, BrowserEvent, BrowserCoreError } from "@handoffkit/browser-core";
import { normalizeFingerprint } from "@handoffkit/csp";
import {
  wrapCommandEnvelope,
  decodeEnvelope,
  identityWithGrants,
  identityFingerprint,
} from "./csp_bridge.js";

const TLS_IO_TIMEOUT_MS = 8_000;

async function withTimeout(promise, ms, message, code) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new BrowserCoreError(message, { code }));
    }, ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Browser Real client. Callback dispatch is an explicit test adapter, not
 * network interoperability. TLS uses full CSP envelopes on browser.control.
 */
export class BrowserRealClient {
  constructor(target, options = {}) {
    this.target = target;
    this.transport = typeof target?.dispatch === "function" ? null : target;
    this.identity = options.identity || null;
    this.testAdapter = typeof target?.dispatch === "function";
    this.lastRequestMessageId = "";
    this.lastResponseCorrelationId = "";
    this.sequences = options.sequences || {
      next: (() => {
        let value = 0;
        return () => {
          value += 1;
          return value;
        };
      })(),
    };
  }

  get authenticatedPeer() {
    return this.transport?.authenticatedPeer ?? null;
  }

  async dispatch(command) {
    const wire = command instanceof BrowserCommand ? command.toWire() : command;
    if (this.testAdapter) {
      const event = await this.target.dispatch(wire);
      return event instanceof BrowserEvent ? event : BrowserEvent.fromWire(event);
    }
    if (typeof this.target?.send !== "function" || typeof this.target?.receive !== "function") {
      throw new BrowserCoreError("Browser Real client requires a service dispatch or TLS transport", {
        code: "invalid_request",
      });
    }
    if (!this.identity || (!identityFingerprint(this.identity) && !this.identity.peerId)) {
      throw new BrowserCoreError("TLS client identity is required", { code: "unauthorized" });
    }
    const envelope = wrapCommandEnvelope({
      command: wire,
      sessionId: wire.session_id,
      sequence: this.sequences.next(),
      identity: this.identity,
    });
    this.lastRequestMessageId = envelope.messageId;
    await withTimeout(
      this.target.send(envelope),
      TLS_IO_TIMEOUT_MS,
      "TLS send timed out",
      "timeout",
    );
    const response = decodeEnvelope(await withTimeout(
      this.target.receive(),
      TLS_IO_TIMEOUT_MS,
      "TLS receive timed out",
      "timeout",
    ));
    this.lastResponseCorrelationId = response.correlationId || "";
    if (response.correlationId && response.correlationId !== envelope.messageId) {
      throw new BrowserCoreError("response correlation_id does not match request message_id", {
        code: "invalid_request",
      });
    }
    const event = BrowserEvent.fromWire(response.payload ?? response);
    if (event.name === "error") {
      throw new BrowserCoreError(event.payload?.message || "browser real error", {
        code: event.payload?.code || "engine_crash",
        details: event.payload || {},
      });
    }
    return event;
  }

  async close() {
    if (this.testAdapter) return;
    const transport = this.transport || this.target;
    if (typeof transport?.destroy === "function") {
      transport.destroy();
      return;
    }
    if (typeof transport?.close === "function") {
      await transport.close({ force: true });
    }
  }
}

export async function connectBrowserRealTls({
  host,
  port,
  networkConfig,
  identity,
  sequences,
  servername = "localhost",
}) {
  const { TcpTransport } = await import("@handoffkit/node");
  const transport = await TcpTransport.connect(host, port, {
    config: networkConfig,
    servername,
  });
  const local = identity || transport.localCertificateIdentity;
  const grants = networkConfig?.identityPolicy?.capabilitiesByFingerprint;
  let sending = local;
  if (local && grants instanceof Map) {
    sending = identityWithGrants(local, grants);
  } else if (local && grants && typeof grants.get !== "function") {
    const map = new Map(
      Object.entries(grants).map(([key, value]) => [normalizeFingerprint(key), value]),
    );
    sending = identityWithGrants(local, map);
  }
  return new BrowserRealClient(transport, { identity: sending, sequences });
}
