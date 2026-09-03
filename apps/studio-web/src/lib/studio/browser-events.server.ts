import "server-only";

import { lstat, readFile } from "node:fs/promises";

import {
  emptyStudioBrowserSnapshot,
  parseStudioBrowserNdjson,
  reduceStudioBrowserEvents,
  STUDIO_BROWSER_MAX_FILE_BYTES,
  StudioBrowserEventError,
} from "./browser-events";
import { applyRuntimeControls, StudioBrowserRuntimeAdapter } from "./browser-runtime.server";

const adapter = new StudioBrowserRuntimeAdapter();

export async function loadStudioBrowserSnapshot() {
  const source = process.env.HANDOFFKIT_STUDIO_BROWSER_EVENTS?.trim();
  if (!source) {
    return applyRuntimeControls(emptyStudioBrowserSnapshot("unconfigured"));
  }
  try {
    const metadata = await lstat(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      return applyRuntimeControls(emptyStudioBrowserSnapshot("invalid", "studio_browser_source_invalid"));
    }
    if (metadata.size > STUDIO_BROWSER_MAX_FILE_BYTES) {
      return applyRuntimeControls(emptyStudioBrowserSnapshot("invalid", "studio_browser_source_too_large"));
    }
    if (process.platform !== "win32" && (metadata.mode & 0o022) !== 0) {
      return applyRuntimeControls(emptyStudioBrowserSnapshot("invalid", "studio_browser_source_permissions"));
    }
    const events = parseStudioBrowserNdjson(await readFile(source, "utf8"));
    const snapshot = reduceStudioBrowserEvents(events, { status: "connected" });
    return applyRuntimeControls(snapshot);
  } catch (error) {
    const code = error instanceof StudioBrowserEventError
      ? error.code
      : "studio_browser_source_unavailable";
    return applyRuntimeControls(emptyStudioBrowserSnapshot("invalid", code));
  }
}

export async function appendStudioBrowserControl(action: string, sessionId = "", expectedVersion = 0) {
  return adapter.dispatch(action, sessionId, expectedVersion);
}
