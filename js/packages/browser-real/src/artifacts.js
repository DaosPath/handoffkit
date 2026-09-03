import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  writeSync,
  chmodSync,
  lstatSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";

import { BrowserCoreError } from "@handoffkit/browser-core";

const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_SCREENSHOT_PREVIEW = 512 * 1024;

function privateMode() {
  return process.platform === "win32" ? 0o666 : 0o600;
}

export class ArtifactStore {
  constructor(root, { retentionMs = DEFAULT_RETENTION_MS } = {}) {
    this.root = path.resolve(root);
    this.retentionMs = retentionMs;
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const stat = lstatSync(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new BrowserCoreError("artifact root must be a regular directory", {
        code: "artifact_write_failed",
        details: { root: this.root },
      });
    }
  }

  async write({ bytes, mime, kind, sessionId }) {
    const id = randomUUID();
    const tmp = path.join(this.root, `.${id}.tmp`);
    const dest = path.join(this.root, `${id}.bin`);
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? "");
    let fd;
    try {
      fd = openSync(tmp, "wx", privateMode());
      writeSync(fd, buffer);
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      renameSync(tmp, dest);
      chmodSync(dest, privateMode());
    } catch (error) {
      if (fd != null) {
        try { closeSync(fd); } catch { /* ignore */ }
      }
      try { unlinkSync(tmp); } catch { /* ignore */ }
      throw new BrowserCoreError(String(error?.message ?? error), {
        code: "artifact_write_failed",
        details: { kind, session_id: sessionId },
      });
    }
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const expiresAt = new Date(Date.now() + this.retentionMs).toISOString();
    return {
      artifact_id: id,
      uri: `handoffkit-artifact://${id}`,
      mime: String(mime || "application/octet-stream"),
      bytes: buffer.byteLength,
      sha256,
      kind: String(kind || "blob"),
      session_id: sessionId || "",
      expires_at: expiresAt,
      path: dest,
    };
  }

  previewPng(bytes) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? "");
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_SCREENSHOT_PREVIEW) return "";
    return `data:image/png;base64,${buffer.toString("base64")}`;
  }
}
