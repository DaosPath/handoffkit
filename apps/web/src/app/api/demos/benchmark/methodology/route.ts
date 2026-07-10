import { NextResponse } from "next/server";

/**
 * GET /api/demos/benchmark/methodology
 * Published independent protocol methodology (no leaderboard, no scores).
 * Mirrors handoffkit.benchmarks.independent.methodology_manifest().
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    kind: "independent_protocol_methodology",
    methodology_id: "handoffkit-protocol-v1",
    methodology_version: "1.0.0",
    seed_default: "handoffkit-independent-2026",
    leaderboard: false,
    run_offline: "handoffkit benchmark-independent",
    docs: "https://github.com/DaosPath/handoffkit/blob/main/packages/python/docs/EXTERNAL_BENCHMARK.md",
    scoring: {
      dimensions: [
        "handoff_validation",
        "handoff_quality",
        "context_loss",
        "latency_offline",
        "task_pass_rate",
      ],
      pass_rule:
        "All handoffs validate; mean quality >= 0.6; every task produces len(roles)-1 handoffs",
    },
    tasks: [
      {
        task_id: "proto-001",
        title: "Release checklist",
        roles: ["Planner", "Implementer", "Reviewer"],
      },
      {
        task_id: "proto-002",
        title: "Incident triage",
        roles: ["Oncall", "Engineer", "Lead"],
      },
      {
        task_id: "proto-003",
        title: "API contract change",
        roles: ["Architect", "Coder", "Reviewer"],
      },
      {
        task_id: "proto-004",
        title: "Docs handoff",
        roles: ["Writer", "Editor", "Approver"],
      },
      {
        task_id: "proto-005",
        title: "Tool safety review",
        roles: ["Requester", "Security", "Operator"],
      },
    ],
    note: "This endpoint publishes methodology only. It is not a public leaderboard.",
  });
}
