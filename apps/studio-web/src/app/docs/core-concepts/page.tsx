import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs/DocsShell";
import { CodeBlock } from "@/components/docs/CodeBlock";

export const metadata: Metadata = { title: "Core Concepts" };

const toc = [
  { id: "contracts", title: "Contracts" },
  { id: "handoff-state", title: "HandoffState" },
  { id: "protocols", title: "Protocols" },
  { id: "teams", title: "Teams" },
  { id: "recipes", title: "Recipes" },
  { id: "traces", title: "Traces & replay" },
  { id: "runtimes", title: "Runtimes" },
];

export default function CoreConceptsPage() {
  return (
    <DocsShell toc={toc}>
      <div className="docs-prose">
        <p className="section-label">Get Started</p>
        <h1 className="!mt-0 text-[clamp(1.75rem,3vw,2.35rem)] font-extrabold tracking-[-0.035em] text-[var(--navy)]">
          Core Concepts
        </h1>
        <p>
          Handoff Kit is contract-first: agents exchange structured state instead
          of vague summaries. These concepts map to stable public APIs in Python
          and TypeScript.
        </p>

        <h2 id="contracts">Cross-runtime contracts</h2>
        <p>
          Canonical JSON schemas and fixtures live in{" "}
          <code>packages/contracts</code>. Wire format uses <code>snake_case</code>{" "}
          (<code>from_agent</code>, <code>to_agent</code>,{" "}
          <code>important_files</code>, <code>next_steps</code>). JavaScript
          exposes camelCase properties in memory and emits snake_case on{" "}
          <code>toJSON()</code>.
        </p>

        <h2 id="handoff-state">HandoffState</h2>
        <p>The unit of transfer between agents:</p>
        <ul>
          <li>
            <strong>task</strong> — what the workflow is doing
          </li>
          <li>
            <strong>from_agent / to_agent</strong> — who is handing off
          </li>
          <li>
            <strong>summary</strong> — concise description of progress
          </li>
          <li>
            <strong>decisions</strong>, <strong>important_files</strong>,{" "}
            <strong>errors</strong>, <strong>next_steps</strong>,{" "}
            <strong>context_refs</strong>
          </li>
          <li>
            <strong>metadata</strong> — extensible key/value bag
          </li>
        </ul>

        <h2 id="protocols">Protocol modes</h2>
        <p>
          <code>HandoffProtocol</code> supports: <code>natural</code>,{" "}
          <code>compressed</code>, <code>hybrid_min</code>, and{" "}
          <code>hybrid_state</code> (recommended for production structure).
        </p>
        <CodeBlock
          code={`from handoffkit import HandoffProtocol

protocol = HandoffProtocol(mode="hybrid_state")
state = protocol.transfer(
    from_agent=architect,
    to_agent=coder,
    task=task,
    summary=output,
    decisions=["Use argparse"],
)`}
          filename="protocol.py"
          language="python"
        />

        <h2 id="teams">Teams</h2>
        <p>
          <code>Team</code> runs agents in sequence, automatically transferring
          handoffs between them. Prefer teams for linear pipelines; use explicit{" "}
          <code>protocol.transfer()</code> when you need full control.
        </p>

        <h2 id="recipes">Recipes</h2>
        <p>
          <code>Recipe</code>, <code>RecipeStep</code>, and{" "}
          <code>RecipeRunner</code> define reusable multi-step workflows (plan →
          execute → review, showcases, media plans). Extensions can register
          recipes and tools.
        </p>

        <h2 id="traces">Traces, replay, reports</h2>
        <ul>
          <li>
            <code>RunTrace</code> / <code>TraceStep</code> /{" "}
            <code>TraceEvent</code> — structured run history
          </li>
          <li>
            <code>ReplayRunner</code> — summarize a trace without re-running side
            effects
          </li>
          <li>
            <code>write_report_files</code>, <code>render_report_html</code> —
            human-readable outputs
          </li>
        </ul>

        <h2 id="runtimes">Runtimes status</h2>
        <div className="not-prose my-4 grid gap-3 sm:grid-cols-2">
          {[
            { name: "Python", status: "Primary", detail: "Full agents, CLI, recipes, providers" },
            { name: "TypeScript", status: "Ready", detail: "@handoffkit/core + /node" },
            { name: "Rust", status: "Future", detail: "Contracts & parity tests; runtime planned" },
            { name: "C++", status: "Future", detail: "Headers & validation; runtime planned" },
          ].map((r) => (
            <div key={r.name} className="liquid-card p-4 !rounded-2xl">
              <div className="relative z-10 flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-[var(--navy)]">{r.name}</p>
                  <p className="mt-1 text-xs text-[var(--navy-muted)]">{r.detail}</p>
                </div>
                <span
                  className={`sdk-badge ${
                    r.status === "Primary"
                      ? "sdk-badge-primary"
                      : r.status === "Ready"
                        ? "sdk-badge-ready"
                        : "sdk-badge-future"
                  }`}
                >
                  {r.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        <p>
          Continue with{" "}
          <Link href="/docs/guides/agents-steps">Agents &amp; Steps</Link>.
        </p>
      </div>
    </DocsShell>
  );
}
