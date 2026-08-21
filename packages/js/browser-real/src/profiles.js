import { mkdirSync, writeFileSync, lstatSync, readFileSync, chmodSync } from "node:fs";
import path from "node:path";

import { BrowserCoreError } from "@handoffkit/browser-core";

export const PROFILE_MARKER = "handoffkit.browser.profile";
export const PROFILE_MARKER_VERSION = 1;

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export function sanitizeProfileId(raw) {
  const value = String(raw ?? "").trim();
  if (!ID_RE.test(value)) {
    throw new BrowserCoreError("profile_id is invalid", {
      code: "profile_denied",
      details: { field: "profile_id" },
    });
  }
  return value;
}

function assertSafeDir(dir) {
  const stat = lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new BrowserCoreError("profile path must be a regular directory owned by HandoffKit", {
      code: "profile_denied",
      details: { path: dir },
    });
  }
}

export function resolveManagedProfile(profileRoot, profileId) {
  const id = sanitizeProfileId(profileId);
  const root = path.resolve(profileRoot);
  assertSafeDir(root);
  const resolved = path.resolve(root, id);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new BrowserCoreError("profile path traversal is denied", {
      code: "profile_denied",
      details: { profile_id: id },
    });
  }
  mkdirSync(resolved, { recursive: true, mode: 0o700 });
  assertSafeDir(resolved);
  const markerPath = path.join(resolved, ".handoffkit-profile.json");
  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    marker = { format: PROFILE_MARKER, version: PROFILE_MARKER_VERSION, profile_id: id };
    writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
  }
  if (marker.format !== PROFILE_MARKER || marker.profile_id !== id) {
    throw new BrowserCoreError("profile directory is missing a HandoffKit marker", {
      code: "profile_denied",
      details: { profile_id: id },
    });
  }
  if (process.platform !== "win32") {
    chmodSync(resolved, 0o700);
    chmodSync(markerPath, 0o600);
  }
  return resolved;
}
