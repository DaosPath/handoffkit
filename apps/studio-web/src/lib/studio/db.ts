/**
 * Studio persistence adapter (P1 foundation).
 *
 * Today: file-backed JSON under apps/web/.data/studio/
 * Next: Postgres (or compatible) implementing the same interfaces.
 */

import type { StoredMaiRun } from "./run-history";
import {
  createDefaultWorkspace,
  fileWorkspaceStore,
  type StudioWorkspace,
  type WorkspaceStore,
} from "./workspace";
import { devAuthProvider, type AuthProvider, type StudioSession } from "./auth";

export type StudioDb = {
  workspaces: WorkspaceStore;
  auth: AuthProvider;
  /** Optional hook: associate a run with a workspace id */
  attachRunMeta(
    run: StoredMaiRun,
    session: StudioSession
  ): StoredMaiRun & { workspaceId: string; userId: string };
  ensureDefaultWorkspace(): Promise<StudioWorkspace>;
};

export const studioDb: StudioDb = {
  workspaces: fileWorkspaceStore,
  auth: devAuthProvider,
  attachRunMeta(run, session) {
    return {
      ...run,
      workspaceId: session.workspaceId,
      userId: session.user.id,
    };
  },
  async ensureDefaultWorkspace() {
    const existing = await fileWorkspaceStore.get("ws_local_default");
    if (existing) return existing;
    return fileWorkspaceStore.upsert(createDefaultWorkspace());
  },
};
