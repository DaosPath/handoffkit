import Link from "next/link";
import {
  ArrowRight,
  Database,
  GitBranch,
  History,
  ScrollText,
} from "lucide-react";
import { DocsShell } from "@/components/docs/DocsShell";
import { CodeBlock } from "@/components/docs/CodeBlock";
import { DocsDiagram } from "@/components/docs/DocsDiagram";
import { GITHUB_URL } from "@/lib/docs-nav";

const toc = [
  { id: "what-is-handoff-kit", title: "What is Handoff Kit?" },
  { id: "quick-example", title: "Quick Example" },
  { id: "core-concepts", title: "Core Concepts" },
  { id: "state", title: "State" },
  { id: "agents", title: "Agents" },
  { id: "steps", title: "Steps" },
  { id: "handoffs", title: "Handoffs" },
  { id: "routing", title: "Routing" },
  { id: "next-steps", title: "Next Steps" },
];

const pillars = [
  {
    icon: Database,
    title: "Structured Handoffs",
    body: "Share state between agents with confidence.",
  },
  {
    icon: GitBranch,
    title: "Intelligent Routing",
    body: "Route tasks to the right agent at the right time.",
  },
  {
    icon: History,
    title: "Replayable Runs",
    body: "Deterministic replays for debugging and evals.",
  },
  {
    icon: ScrollText,
    title: "Audit & Observability",
    body: "Full event logs and explainable trails.",
  },
];

const concepts = [
  {
    id: "state",
    title: "State",
    body: "The typed object every agent can read and update — in Python and TypeScript via HandoffState.",
  },
  {
    id: "agents",
    title: "Agents",
    body: "Specialized workers responsible for part of the workflow.",
  },
  {
    id: "steps",
    title: "Steps",
    body: "Executable units that transform shared state — team steps, recipe steps, or tool runs.",
  },
  {
    id: "handoffs",
    title: "Handoffs",
    body: "Explicit transitions between agents with structured context.",
  },
  {
    id: "routing",
    title: "Routing",
    body: "Protocol modes and team order that decide where work goes next.",
  },
  {
    id: "reports",
    title: "Reports",
    body: "Human-readable summaries of every run — JSON, Markdown, and HTML.",
  },
];

const pythonExample = `from handoffkit import Agent, HandoffProtocol, Team, RunTrace, ReplayRunner

team = Team(
    agents=[
        Agent("Architect", "Plan the work."),
        Agent("Coder", "Implement the work."),
        Agent("Tester", "Verify the work."),
    ],
    protocol=HandoffProtocol(mode="hybrid_state"),
)

result = team.run("Build a small calculator CLI with tests.")
trace = RunTrace.from_team_result(result)
replay = ReplayRunner(trace).summary()

print(result.final_output)
print(replay)
`;

const jsExample = `import { Agent, HandoffProtocol, Team, RunTrace, ReplayRunner } from "@handoffkit/core";

const team = new Team({
  agents: [
    new Agent({ name: "Architect", role: "Plan the work." }),
    new Agent({ name: "Coder", role: "Implement the work." }),
    new Agent({ name: "Tester", role: "Verify the work." }),
  ],
  protocol: new HandoffProtocol({ mode: "hybrid_state" }),
});

const result = team.run("Build a small calculator CLI with tests.");
const trace = RunTrace.fromTeamResult(result);
const replay = new ReplayRunner(trace).summary();

console.log(result.finalOutput);
console.log(replay);
`;

export default function DocsIntroductionPage() {
  return (
    <DocsShell toc={toc}>
      {/* Hero */}
      <section className="liquid-card relative overflow-hidden p-6 sm:p-8 lg:p-10">
        <div className="liquid-blob liquid-blob-blue absolute -right-10 -top-12 h-56 w-56 opacity-60" />
        <div
          className="liquid-blob liquid-blob-soft absolute bottom-0 right-20 h-40 w-40 opacity-50"
          style={{ animationDelay: "-4s" }}
        />
        <span className="liquid-bubble right-[18%] top-[28%] h-3 w-3" />
        <span
          className="liquid-bubble right-[30%] top-[55%] h-2 w-2"
          style={{ animationDelay: "1.2s" }}
        />

        <div className="relative z-10 grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold text-[var(--blue)]">Welcome to</p>
            <h1 className="mt-1 text-[clamp(2rem,4vw,2.85rem)] font-extrabold tracking-[-0.04em] text-[var(--navy)]">
              Handoff Kit
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-[var(--navy-muted)] sm:text-lg">
              The open-source framework for building reliable, observable, and
              auditable multi-agent systems.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="chip">
                <span className="chip-dot" />
                Python primary
              </span>
              <span className="chip">
                <span className="chip-dot" />
                TypeScript ready
              </span>
              <span className="chip">Rust &amp; C++ planned</span>
            </div>
          </div>

          <div className="relative hidden min-h-[160px] lg:block">
            <div className="liquid-surface absolute inset-0 rounded-[32px] p-0">
              <div className="liquid-blob liquid-blob-blue absolute left-1/4 top-1/4 h-32 w-32" />
              <div className="liquid-blob liquid-blob-white absolute bottom-4 right-6 h-24 w-24 liquid-blob-sm" />
              <span className="liquid-bubble left-[20%] top-[30%] h-4 w-4" />
              <span className="liquid-bubble right-[25%] top-[40%] h-2.5 w-2.5" />
            </div>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {pillars.map((p) => (
          <article key={p.title} className="liquid-card p-5 !rounded-2xl">
            <div className="relative z-10">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(37,99,255,0.1)] text-[var(--blue)]">
                <p.icon size={18} />
              </div>
              <h3 className="text-sm font-semibold text-[var(--navy)]">{p.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-[var(--navy-muted)]">
                {p.body}
              </p>
            </div>
          </article>
        ))}
      </div>

      <div className="docs-prose mt-4">
        <h2 id="what-is-handoff-kit">What is Handoff Kit?</h2>
        <p>
          Handoff Kit helps you orchestrate AI agents that collaborate through a
          shared, typed state. Define your state, register agents, choose a
          protocol mode, and run. Every handoff is logged, replayable, and built
          for production.
        </p>
        <p>
          Instead of free-text “context soup,” agents pass a structured{" "}
          <code>HandoffState</code> contract: task, decisions, files, errors, next
          steps, and metadata. The same wire format is shared across Python and
          TypeScript today, with Rust and C++ contract packages on the roadmap.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link
            href="/docs/quick-start"
            className="liquid-button !text-white hover:!text-white"
          >
            Quick Start
            <ArrowRight size={15} className="text-white" />
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="liquid-button-secondary !text-[var(--navy)] hover:!text-[var(--navy)]"
          >
            View on GitHub
          </a>
        </div>

        <h2 id="quick-example">Quick Example</h2>
        <p>
          Run a three-agent team with structured handoffs. Offline by default with
          the built-in Echo provider — no API keys required for local demos.
        </p>

        <div className="not-prose mt-4 grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(240px,0.65fr)]">
          <div className="min-w-0 max-w-full">
            <CodeBlock code={pythonExample} filename="team_demo.py" language="python" />
          </div>
          <div className="min-w-0 xl:sticky xl:top-24">
            <DocsDiagram />
          </div>
        </div>

        <p className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--navy-muted)]">
          TypeScript (same contracts)
        </p>
        <div className="not-prose">
          <CodeBlock code={jsExample} filename="team-demo.js" language="javascript" />
        </div>

        <h2 id="core-concepts">Core Concepts</h2>
        <p>
          These building blocks map directly to the public Python and JavaScript
          APIs. Use them to reason about any multi-agent workflow.
        </p>

        <div className="not-prose mt-4 grid gap-4 sm:grid-cols-2">
          {concepts.map((c) => (
            <article key={c.id} id={c.id} className="liquid-card scroll-mt-24 p-5 !rounded-2xl">
              <div className="relative z-10">
                <h3 className="!mt-0 text-base font-semibold text-[var(--navy)]">
                  {c.title}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-[var(--navy-muted)]">
                  {c.body}
                </p>
              </div>
            </article>
          ))}
        </div>

        <h2 id="next-steps">Next Steps</h2>
        <ul>
          <li>
            <Link href="/docs/installation">Install</Link> Python or TypeScript
            packages
          </li>
          <li>
            Follow the <Link href="/docs/quick-start">Quick Start</Link> for your
            first team run
          </li>
          <li>
            Read <Link href="/docs/core-concepts">Core Concepts</Link> for
            HandoffState, protocols, traces, and reports
          </li>
          <li>
            Explore <Link href="/docs/reference/cli">CLI Reference</Link> for
            demos, showcases, and report rendering
          </li>
        </ul>
      </div>
    </DocsShell>
  );
}
