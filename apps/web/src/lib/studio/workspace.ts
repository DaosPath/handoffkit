/**
 * Studio workspaces (P1 foundation).
 *
 * A workspace scopes MAI runs, providers, and future auth subjects.
 * Storage is still local-first; the interface is DB-ready for P1+.
 */

export type StudioWorkspace = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  /** Owner subject id once auth is wired */
  ownerId?: string;
  metadata?: Record<string, unknown>;
};

export type WorkspaceStore = {
  list(): Promise<StudioWorkspace[]>;
  get(id: string): Promise<StudioWorkspace | null>;
  upsert(ws: StudioWorkspace): Promise<StudioWorkspace>;
  remove(id: string): Promise<boolean>;
};

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), ".data", "studio");
const WORKSPACES_FILE = join(DATA_DIR, "workspaces.json");

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readAll(): StudioWorkspace[] {
  ensureDir();
  if (!existsSync(WORKSPACES_FILE)) return [];
  try {
    const raw = JSON.parse(readFileSync(WORKSPACES_FILE, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeAll(items: StudioWorkspace[]) {
  ensureDir();
  writeFileSync(WORKSPACES_FILE, JSON.stringify(items, null, 2), "utf8");
}

/** Default local workspace store (file-backed, single-node). */
export const fileWorkspaceStore: WorkspaceStore = {
  async list() {
    return readAll().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async get(id) {
    return readAll().find((w) => w.id === id) ?? null;
  },
  async upsert(ws) {
    const all = readAll();
    const idx = all.findIndex((w) => w.id === ws.id);
    if (idx >= 0) all[idx] = ws;
    else all.push(ws);
    writeAll(all);
    return ws;
  },
  async remove(id) {
    const all = readAll();
    const next = all.filter((w) => w.id !== id);
    writeAll(next);
    return next.length !== all.length;
  },
};

export function createDefaultWorkspace(): StudioWorkspace {
  const now = new Date().toISOString();
  return {
    id: "ws_local_default",
    name: "Local Studio",
    slug: "local",
    createdAt: now,
    updatedAt: now,
    metadata: { backend: "file", note: "Replace with DB-backed store for multi-user" },
  };
}
