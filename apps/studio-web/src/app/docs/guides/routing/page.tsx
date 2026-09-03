import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs/DocsShell";
import { CodeBlock } from "@/components/docs/CodeBlock";

export const metadata: Metadata = { title: "Routing" };

const toc = [
  { id: "order", title: "Team order" },
  { id: "modes", title: "Protocol modes" },
  { id: "explicit", title: "Explicit transfer" },
];

export default function RoutingPage() {
  return (
    <DocsShell toc={toc}>
      <div className="docs-prose">
        <p className="section-label">Guides</p>
        <h1 className="!mt-0 text-[clamp(1.75rem,3vw,2.35rem)] font-extrabold tracking-[-0.035em] text-[var(--navy)]">
          Routing
        </h1>
        <p>
          Routing in Handoff Kit is intentional: agent order, protocol mode, and
          explicit transfers decide where work goes next — not opaque free-text
          prompts alone.
        </p>

        <h2 id="order">Team order</h2>
        <p>
          <code>Team</code> always runs agents in the sequence you provide. That
          sequence is your primary routing policy for linear pipelines
          (Architect → Coder → Tester, Intake → Hypothesis → Reviewer, etc.).
        </p>

        <h2 id="modes">Protocol modes</h2>
        <ul>
          <li>
            <code>hybrid_state</code> — structured fields + summary (recommended)
          </li>
          <li>
            <code>hybrid_min</code> — lighter structured hybrid
          </li>
          <li>
            <code>compressed</code> — compact transfer
          </li>
          <li>
            <code>natural</code> — freer natural-language oriented transfer
          </li>
        </ul>
        <CodeBlock
          code={`from handoffkit import HandoffProtocol

for mode in ("hybrid_state", "hybrid_min", "compressed", "natural"):
    protocol = HandoffProtocol(mode=mode)
    print(protocol.mode)`}
          filename="modes.py"
          language="python"
        />

        <h2 id="explicit">Explicit transfer</h2>
        <p>
          For branching or custom graphs, call{" "}
          <code>protocol.transfer(...)</code> yourself and pass the resulting
          state into the next agent with <code>handoff_state=</code>.
        </p>
        <CodeBlock
          code={`handoff = protocol.transfer(
    from_agent=triage,
    to_agent=analyst,
    task=ticket,
    summary=triage_output,
    decisions=["Severity: critical"],
    next_steps=["Isolate DB pool leak"],
).validate()

analyst_output = analyst.run(ticket, handoff_state=handoff)`}
          filename="explicit_route.py"
          language="python"
        />

        <p>
          Next: <Link href="/docs/guides/tools">Tools &amp; Integrations</Link>
        </p>
      </div>
    </DocsShell>
  );
}
