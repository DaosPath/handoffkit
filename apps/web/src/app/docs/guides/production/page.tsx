import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs/DocsShell";
import { CodeBlock } from "@/components/docs/CodeBlock";

export const metadata: Metadata = { title: "Deploy to Production" };

const toc = [
  { id: "checklist", title: "Checklist" },
  { id: "offline", title: "Offline-first" },
  { id: "keys", title: "Secrets" },
  { id: "gates", title: "Quality gates" },
];

export default function ProductionPage() {
  return (
    <DocsShell toc={toc}>
      <div className="docs-prose">
        <p className="section-label">Guides</p>
        <h1 className="!mt-0 text-[clamp(1.75rem,3vw,2.35rem)] font-extrabold tracking-[-0.035em] text-[var(--navy)]">
          Deploy to Production
        </h1>
        <p>
          Ship multi-agent workflows that are observable, contract-validated, and
          safe to operate. Handoff Kit is designed offline-first so CI stays
          deterministic.
        </p>

        <h2 id="checklist">Production checklist</h2>
        <ul>
          <li>Use <code>hybrid_state</code> protocol for structured handoffs</li>
          <li>Validate every handoff with <code>.validate()</code> or validators</li>
          <li>Persist <code>RunTrace</code> artifacts per run</li>
          <li>Render reports for human review and incident response</li>
          <li>Gate releases on quality + evaluation scores</li>
          <li>Keep live provider calls behind explicit credentials</li>
        </ul>

        <h2 id="offline">Offline-first CI</h2>
        <CodeBlock
          code={`handoffkit doctor
handoffkit demo
handoffkit showcase coding-review
handoffkit validate-report runs/latest/report.json
handoffkit report runs/latest`}
          filename="ci"
          language="bash"
        />

        <h2 id="keys">Secrets &amp; providers</h2>
        <p>
          Store keys in environment variables or via the local CLI key helpers.
          Never hardcode credentials in recipes or examples.
        </p>
        <CodeBlock
          code={`handoffkit keys set NVIDIA_API_KEY
handoffkit keys list
# providers probe is opt-in and requires real keys`}
          filename="keys"
          language="bash"
        />

        <h2 id="gates">Quality gates</h2>
        <CodeBlock
          code={`from handoffkit import HandoffQualityEvaluator

report = HandoffQualityEvaluator(min_score=0.75).evaluate(handoff)
if not report.success:
    raise SystemExit(f"Handoff quality failed: {report.grade}")`}
          filename="gates.py"
          language="python"
        />

        <p>
          Reference: <Link href="/docs/reference/api">API</Link> ·{" "}
          <Link href="/docs/reference/cli">CLI</Link>
        </p>
      </div>
    </DocsShell>
  );
}
