import { NextResponse } from "next/server";
import {
  buildStoredRun,
  exportBenchmarkCorpus,
  getStoredRun,
  listStoredRuns,
  saveStoredRunWithStudio,
} from "@/lib/studio/run-history";
import { studioDb } from "@/lib/studio/db";

export const runtime = "nodejs";

/**
 * GET /api/demos/mai-panel/runs
 *   ?limit=50
 *   ?id=run_xxx
 *   ?export=benchmark
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const exp = searchParams.get("export");
  const limit = Math.min(
    200,
    Math.max(1, Number(searchParams.get("limit") || 40))
  );
  const workspace = await studioDb.ensureDefaultWorkspace();
  const session = await studioDb.auth.getSession();
  const workspaceId =
    searchParams.get("workspaceId") ||
    session?.workspaceId ||
    workspace.id;

  if (exp === "benchmark") {
    const corpus = exportBenchmarkCorpus(500);
    return NextResponse.json({
      ok: true,
      kind: "benchmark-corpus",
      workspaceId,
      ...corpus,
      note: "Aggregated studio runs with benchmarkReady=true. Use for future public benchmarks when volume is high.",
    });
  }

  if (id) {
    const run = getStoredRun(id);
    if (!run) {
      return NextResponse.json(
        { ok: false, error: "Run not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, workspaceId, run });
  }

  const runs = listStoredRuns(limit, { workspaceId });
  return NextResponse.json({
    ok: true,
    workspaceId,
    count: runs.length,
    runs,
  });
}

type PostBody = {
  result?: Parameters<typeof buildStoredRun>[0]["result"];
  casePreset?: string;
  runId?: string;
};

/**
 * POST /api/demos/mai-panel/runs
 * Persist a completed panel run for history + future benchmarks.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as PostBody;
    if (!body.result || typeof body.result !== "object") {
      return NextResponse.json(
        { ok: false, error: "Missing result payload" },
        { status: 400 }
      );
    }
    const stored = await saveStoredRunWithStudio(
      buildStoredRun({
        result: body.result,
        casePreset: body.casePreset,
        runId: body.runId,
      })
    );
    return NextResponse.json({
      ok: true,
      id: stored.id,
      workspaceId: stored.workspaceId,
      benchmarkReady: stored.benchmarkReady,
      rankings: stored.rankings.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
