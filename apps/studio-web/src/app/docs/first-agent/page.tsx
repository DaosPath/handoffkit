import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs/DocsShell";
import { CodeBlock } from "@/components/docs/CodeBlock";

export const metadata: Metadata = { title: "Your First Agent" };

const toc = [
  { id: "single", title: "Single agent" },
  { id: "handoff", title: "Explicit handoff" },
  { id: "validate", title: "Validate state" },
  { id: "next", title: "Next" },
];

export default function FirstAgentPage() {
  return (
    <DocsShell toc={toc}>
      <div className="docs-prose">
        <p className="section-label">Get Started</p>
        <h1 className="!mt-0 text-[clamp(1.75rem,3vw,2.35rem)] font-extrabold tracking-[-0.035em] text-[var(--navy)]">
          Your First Agent
        </h1>
        <p>
          Start with one agent, then pass structured state to the next. This is
          the foundation of every Handoff Kit workflow.
        </p>

        <h2 id="single">Run a single agent</h2>
        <CodeBlock
          code={`from handoffkit import Agent

agent = Agent(
    name="Planner",
    role="Create concise implementation plans with decisions and next steps.",
)
result = agent.run("Create a plan for a Python CLI app with tests.")
print(result)`}
          filename="simple_agent.py"
          language="python"
        />

        <h2 id="handoff">Build an explicit handoff</h2>
        <CodeBlock
          code={`from handoffkit import Agent, HandoffProtocol

task = "Create a small Python CLI calculator with tests."
protocol = HandoffProtocol(mode="hybrid_state")

architect = Agent("Architect", "Create implementation plans.")
coder = Agent("Coder", "Implement code based on structured state.")

architect_output = architect.run(task)
coder_state = protocol.transfer(
    from_agent=architect,
    to_agent=coder,
    task=task,
    summary=architect_output,
    decisions=["Expose calculator operations through a small CLI."],
    important_files=["calculator.py", "tests/test_calculator.py"],
    next_steps=["Implement CLI parser.", "Add pytest coverage."],
).validate()

print(coder_state.to_json())
coder_output = coder.run(task, handoff_state=coder_state)
print(coder_output)`}
          filename="coding_team.py"
          language="python"
        />

        <h2 id="validate">Validate before you pass state</h2>
        <p>
          Required fields on <code>HandoffState</code> are <code>task</code>,{" "}
          <code>from_agent</code>, and <code>to_agent</code>. Call{" "}
          <code>.validate()</code> or inspect <code>.validate_report()</code> to
          catch contract issues early.
        </p>
        <CodeBlock
          code={`from handoffkit import HandoffState

state = HandoffState(
    task="Build a CLI",
    from_agent="Architect",
    to_agent="Coder",
    summary="Use structured handoffs.",
    decisions=["Use argparse"],
    important_files=["main.py"],
    next_steps=["Implement"],
)
state.validate()
print(state.to_markdown())`}
          filename="validate_state.py"
          language="python"
        />

        <h2 id="next">Next</h2>
        <ul>
          <li>
            <Link href="/docs/core-concepts">Core Concepts</Link>
          </li>
          <li>
            <Link href="/docs/guides/agents-steps">Agents &amp; Steps</Link>
          </li>
          <li>
            <Link href="/docs/guides/state">State Management</Link>
          </li>
        </ul>
      </div>
    </DocsShell>
  );
}
