import { NextResponse } from "next/server";
import {
  buildStoredRun,
  exportBenchmarkCorpus,
  getStoredRun,
  listStoredRuns,
  saveStoredRun,
} from "@/lib/studio/run-history";

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

  if (exp === "benchmark") {
    const corpus = exportBenchmarkCorpus(500);
    return NextResponse.json({
      ok: true,
      kind: "benchmark-corpus",
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
    return NextResponse.json({ ok: true, run });
  }

  const runs = listStoredRuns(limit);
  return NextResponse.json({
    ok: true,
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
    const stored = saveStoredRun(
      buildStoredRun({
        result: body.result,
        casePreset: body.casePreset,
        runId: body.runId,
      })
    );
    return NextResponse.json({
      ok: true,
      id: stored.id,
      benchmarkReady: stored.benchmarkReady,
      rankings: stored.rankings.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
