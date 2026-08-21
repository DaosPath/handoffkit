import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
  unlinkSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import path from "node:path";

import { BrowserCoreError } from "@handoffkit/browser-core";

const FORMAT = "handoffkit.browser.session-journal";
const VERSION = 1;

function checksum(payload) {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

export class SessionJournal {
  constructor(filePath) {
    this.path = path.resolve(filePath);
    mkdirSync(path.dirname(this.path), { recursive: true, mode: 0o700 });
    this.sessions = new Map();
    this.load();
  }

  load() {
    if (!existsSync(this.path)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));
      if (parsed.format !== FORMAT || parsed.checksum !== checksum(parsed.payload)) {
        throw new Error("checksum mismatch");
      }
      for (const item of parsed.payload.sessions || []) {
        this.sessions.set(item.session_id, item);
      }
    } catch {
      const quarantine = `${this.path}.corrupt`;
      copyFileSync(this.path, quarantine);
      this.sessions.clear();
    }
  }

  record(session) {
    const status = session.status === "ready" || session.status === "running"
      ? session.status
      : session.status;
    this.sessions.set(session.id, {
      session_id: session.id,
      status,
      current_url: session.currentUrl || "",
      profile_id: session.profileId || "",
      updated_at: new Date().toISOString(),
    });
    this.flush();
  }

  interruptOpen() {
    for (const item of this.sessions.values()) {
      if (item.status === "ready" || item.status === "running" || item.status === "paused") {
        item.status = "interrupted";
        item.updated_at = new Date().toISOString();
      }
    }
    this.flush();
  }

  get(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  flush() {
    const payload = { sessions: [...this.sessions.values()] };
    const document = { format: FORMAT, version: VERSION, payload, checksum: checksum(payload) };
    const tmp = `${this.path}.${process.pid}.tmp`;
    const fd = openSync(tmp, "wx", 0o600);
    try {
      writeSync(fd, `${JSON.stringify(document)}\n`);
      fsyncSync(fd);
      closeSync(fd);
      const backup = `${this.path}.bak`;
      if (existsSync(this.path)) copyFileSync(this.path, backup);
      renameSync(tmp, this.path);
    } catch (error) {
      try { closeSync(fd); } catch { /* ignore */ }
      try { unlinkSync(tmp); } catch { /* ignore */ }
      throw new BrowserCoreError(String(error?.message ?? error), { code: "artifact_write_failed" });
    }
  }
}
