import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs/DocsShell";
import { CodeBlock } from "@/components/docs/CodeBlock";

export const metadata: Metadata = { title: "Observability" };

const toc = [
  { id: "traces", title: "Traces" },
  { id: "replay", title: "Replay" },
  { id: "reports", title: "Reports" },
  { id: "eval", title: "Evaluation" },
];

export default function ObservabilityPage() {
  return (
    <DocsShell toc={toc}>
      <div className="docs-prose">
        <p className="section-label">Guides</p>
        <h1 className="!mt-0 text-[clamp(1.75rem,3vw,2.35rem)] font-extrabold tracking-[-0.035em] text-[var(--navy)]">
          Observability
        </h1>
        <p>
          Every production multi-agent system needs explainable trails. Handoff
          Kit records steps, handoffs, tool results, and final output so you can
          audit and replay without re-executing side effects.
        </p>

        <h2 id="traces">Run traces</h2>
        <CodeBlock
          code={`from handoffkit import Team, Agent, HandoffProtocol, RunTrace

team = Team(
    agents=[Agent("A", "Plan"), Agent("B", "Do")],
    protocol=HandoffProtocol(mode="hybrid_state"),
)
result = team.run("Ship a checklist")
trace = RunTrace.from_team_result(result)
print(trace.to_markdown())
print(trace.to_timeline())`}
          filename="trace.py"
          language="python"
        />
        <CodeBlock
          code={`import { RunTrace, Team, Agent } from "@handoffkit/core";

const result = team.run("Ship a checklist");
const trace = RunTrace.fromTeamResult(result);
console.log(trace.toMarkdown());`}
          filename="trace.js"
          language="javascript"
        />

        <h2 id="replay">Replay</h2>
        <CodeBlock
          code={`from handoffkit import ReplayRunner

summary = ReplayRunner(trace).summary()
print(summary)`}
          filename="replay.py"
          language="python"
        />

        <h2 id="reports">Reports</h2>
        <CodeBlock
          code={`from handoffkit import write_report_files

write_report_files(trace, run_id="latest", output_dir="runs")
# CLI: handoffkit report runs/latest`}
          filename="reports.py"
          language="python"
        />
        <CodeBlock
          code={`import { FileTraceStore, writeReportFiles, RunTrace } from "@handoffkit/node";

const trace = RunTrace.fromTeamResult(result);
await new FileTraceStore({ root: "traces" }).save(trace, "latest");
await writeReportFiles(trace, "latest", "reports");`}
          filename="reports.js"
          language="javascript"
        />

        <h2 id="eval">Workflow evaluation</h2>
        <p>
          <code>WorkflowEvaluator</code> and related evaluation types score runs
          offline for CI and regression checks. Use them with saved traces and
          handoff quality reports.
        </p>

        <p>
          Next: <Link href="/docs/guides/production">Deploy to Production</Link>
        </p>
      </div>
    </DocsShell>
  );
}
