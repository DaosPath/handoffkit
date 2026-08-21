import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs/DocsShell";
import { CodeBlock } from "@/components/docs/CodeBlock";

export const metadata: Metadata = { title: "Examples" };

const toc = [
  { id: "showcases", title: "Showcases" },
  { id: "python", title: "Python examples" },
  { id: "js", title: "JavaScript examples" },
];

export default function ExamplesPage() {
  return (
    <DocsShell toc={toc}>
      <div className="docs-prose">
        <p className="section-label">Examples</p>
        <h1 className="!mt-0 text-[clamp(1.75rem,3vw,2.35rem)] font-extrabold tracking-[-0.035em] text-[var(--navy)]">
          Examples
        </h1>
        <p>
          Offline showcases and monorepo examples demonstrate real multi-agent
          patterns with structured handoffs.
        </p>

        <h2 id="showcases">CLI showcases</h2>
        <CodeBlock
          code={`handoffkit demos
handoffkit showcase coding-review
handoffkit showcase support-escalation
handoffkit showcase research-workflow
handoffkit showcase doctor-orchestrator
handoffkit demo-fusion
handoffkit demo-media`}
          filename="showcases"
          language="bash"
        />

        <h2 id="python">Python package examples</h2>
        <p>
          Under <code>packages/python/examples/</code>:
        </p>
        <ul>
          <li>
            <code>simple_agent.py</code> — single Echo agent
          </li>
          <li>
            <code>coding_team.py</code> — Architect → Coder → Tester handoffs
          </li>
          <li>
            <code>support_escalation.py</code> — triage routing
          </li>
          <li>
            <code>research_workflow.py</code> — sources &amp; claims pipeline
          </li>
          <li>
            <code>replay_demo.py</code>, <code>trace_demo.py</code> — observability
          </li>
        </ul>

        <h2 id="js">JavaScript</h2>
        <CodeBlock
          code={`import { Agent, HandoffProtocol, Team, RunTrace, ReplayRunner } from "@handoffkit/core";

const team = new Team({
  agents: [
    new Agent({ name: "Architect", role: "Plan the work." }),
    new Agent({ name: "Coder", role: "Implement the work." }),
    new Agent({ name: "Tester", role: "Verify the work." }),
  ],
  protocol: new HandoffProtocol({ mode: "hybrid_state" }),
});

const result = team.run("Build a small calculator CLI.");
const trace = RunTrace.fromTeamResult(result);
console.log(new ReplayRunner(trace).summary());`}
          filename="js-example.js"
          language="javascript"
        />

        <p>
          Back to <Link href="/docs">Introduction</Link> or{" "}
          <Link href="/docs/quick-start">Quick Start</Link>.
        </p>
      </div>
    </DocsShell>
  );
}
