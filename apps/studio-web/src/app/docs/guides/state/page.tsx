import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs/DocsShell";
import { CodeBlock } from "@/components/docs/CodeBlock";

export const metadata: Metadata = { title: "State Management" };

const toc = [
  { id: "fields", title: "Fields" },
  { id: "serialize", title: "Serialize" },
  { id: "validate", title: "Validate" },
  { id: "quality", title: "Quality" },
];

export default function StateGuidePage() {
  return (
    <DocsShell toc={toc}>
      <div className="docs-prose">
        <p className="section-label">Guides</p>
        <h1 className="!mt-0 text-[clamp(1.75rem,3vw,2.35rem)] font-extrabold tracking-[-0.035em] text-[var(--navy)]">
          State Management
        </h1>
        <p>
          <code>HandoffState</code> is the shared contract every agent can read
          and write. Keep it JSON-friendly so Python, TypeScript, and future
          runtimes stay compatible.
        </p>

        <h2 id="fields">Fields</h2>
        <ul>
          <li>
            Required: <code>task</code>, <code>from_agent</code>,{" "}
            <code>to_agent</code>
          </li>
          <li>
            Lists: <code>decisions</code>, <code>important_files</code>,{" "}
            <code>errors</code>, <code>next_steps</code>,{" "}
            <code>context_refs</code>
          </li>
          <li>
            Free-form: <code>summary</code>, <code>metadata</code>
          </li>
        </ul>

        <h2 id="serialize">Serialize &amp; parse</h2>
        <CodeBlock
          code={`from handoffkit import HandoffState

state = HandoffState(
    task="Build a CLI",
    from_agent="Architect",
    to_agent="Coder",
    summary="Use structured handoffs.",
)
payload = state.to_dict()       # snake_case wire format
again = HandoffState.from_dict(payload)
print(state.to_json())
print(state.to_markdown())`}
          filename="state_py.py"
          language="python"
        />
        <CodeBlock
          code={`import { HandoffState } from "@handoffkit/core";

const state = new HandoffState({
  task: "Build a CLI",
  fromAgent: "Architect",
  toAgent: "Coder",
  summary: "Use structured handoffs.",
});

console.log(state.fromAgent);           // camelCase in memory
console.log(JSON.stringify(state));     // snake_case on the wire
const parsed = HandoffState.fromJSON(state.toJSON());`}
          filename="state_js.js"
          language="javascript"
        />

        <h2 id="validate">Validate</h2>
        <CodeBlock
          code={`report = state.validate_report()
if not report.success:
    for issue in report.issues:
        print(issue.code, issue.message, issue.field)

state.validate()  # raises HandoffValidationError on failure`}
          filename="validate.py"
          language="python"
        />

        <h2 id="quality">Quality scoring</h2>
        <p>
          Use <code>HandoffQualityEvaluator</code> to score completeness of
          handoffs (decisions, files, next steps, etc.) for evals and CI gates.
        </p>
        <CodeBlock
          code={`from handoffkit import HandoffQualityEvaluator

report = HandoffQualityEvaluator().evaluate(state)
print(report.score, report.grade)
print(report.to_markdown())`}
          filename="quality.py"
          language="python"
        />

        <p>
          Next: <Link href="/docs/guides/routing">Routing</Link>
        </p>
      </div>
    </DocsShell>
  );
}
