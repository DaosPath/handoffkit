import type { Metadata } from "next";
import { DocsShell } from "@/components/docs/DocsShell";
import { CodeBlock } from "@/components/docs/CodeBlock";

export const metadata: Metadata = { title: "Events" };

const toc = [
  { id: "model", title: "Event model" },
  { id: "steps", title: "Steps" },
  { id: "usage", title: "Usage" },
];

export default function EventsPage() {
  return (
    <DocsShell toc={toc}>
      <div className="docs-prose">
        <p className="section-label">Reference</p>
        <h1 className="!mt-0 text-[clamp(1.75rem,3vw,2.35rem)] font-extrabold tracking-[-0.035em] text-[var(--navy)]">
          Events
        </h1>
        <p>
          Observability events are attached to run traces. Use them for timelines,
          audits, and post-run analysis.
        </p>

        <h2 id="model">TraceEvent</h2>
        <p>
          A <code>TraceEvent</code> records a discrete moment in a step:
        </p>
        <ul>
          <li>
            <code>kind</code> — event category
          </li>
          <li>
            <code>message</code> — human-readable detail
          </li>
          <li>
            <code>timestamp</code> — optional ISO time
          </li>
          <li>
            <code>metadata</code> — structured extras
          </li>
        </ul>

        <h2 id="steps">TraceStep</h2>
        <p>
          Each <code>TraceStep</code> may include agent name, task, mode, success
          flag, output, nested handoff state, tool results, and a list of events.
        </p>

        <h2 id="usage">Building a timeline</h2>
        <CodeBlock
          code={`from handoffkit import RunTrace

trace = RunTrace.from_team_result(result)
print(trace.to_timeline())
for step in trace.steps:
    for event in step.events:
        print(event.kind, event.message)`}
          filename="events.py"
          language="python"
        />
        <CodeBlock
          code={`import { RunTrace } from "@handoffkit/core";

const trace = RunTrace.fromTeamResult(result);
console.log(trace.toTimeline());
for (const step of trace.steps ?? []) {
  console.log(step);
}`}
          filename="events.js"
          language="javascript"
        />
      </div>
    </DocsShell>
  );
}
