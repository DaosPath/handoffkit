import "server-only";

import { lstat, readFile } from "node:fs/promises";

import {
  emptyStudioSecuritySnapshot,
  assertGoGatewayEvents,
  parseStudioSecurityNdjson,
  reduceStudioSecurityEvents,
  STUDIO_SECURITY_MAX_FILE_BYTES,
  StudioSecurityEventError,
  type StudioSecuritySnapshot,
} from "./security-events";

export async function loadStudioSecuritySnapshot(): Promise<StudioSecuritySnapshot> {
  const source = process.env.HANDOFFKIT_STUDIO_SECURITY_EVENTS?.trim();
  if (!source) return emptyStudioSecuritySnapshot("unconfigured");

  try {
    const metadata = await lstat(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      return emptyStudioSecuritySnapshot("invalid", "studio_event_source_invalid");
    }
    if (metadata.size > STUDIO_SECURITY_MAX_FILE_BYTES) {
      return emptyStudioSecuritySnapshot("invalid", "studio_event_source_too_large");
    }
    if (process.platform !== "win32" && (metadata.mode & 0o022) !== 0) {
      return emptyStudioSecuritySnapshot("invalid", "studio_event_source_permissions");
    }
    const events = parseStudioSecurityNdjson(await readFile(source, "utf8"));
    assertGoGatewayEvents(events);
    return reduceStudioSecurityEvents(events, { status: "connected" });
  } catch (error) {
    const code = error instanceof StudioSecurityEventError
      ? error.code
      : "studio_event_source_unavailable";
    return emptyStudioSecuritySnapshot("invalid", code);
  }
}
