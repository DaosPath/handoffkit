import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  Code2,
  Package,
  Terminal,
} from "lucide-react";
import { DocsShell } from "@/components/docs/DocsShell";
import { CodeBlock } from "@/components/docs/CodeBlock";

export const metadata: Metadata = { title: "Quick Start" };

const toc = [
  { id: "install", title: "Install" },
  { id: "first-team", title: "First team" },
  { id: "cli-showcase", title: "CLI showcase" },
  { id: "javascript", title: "TypeScript" },
  { id: "next", title: "What’s next" },
];

const steps = [
  {
    n: "1",
    title: "Install",
    body: "Add Handoff Kit for Python or TypeScript.",
    href: "#install",
  },
  {
    n: "2",
    title: "Run a team",
    body: "Create agents and pass structured handoffs.",
    href: "#first-team",
  },
  {
    n: "3",
    title: "Try the CLI",
    body: "Run offline showcases and render reports.",
    href: "#cli-showcase",
  },
  {
    n: "4",
    title: "Use TypeScript",
    body: "Same contracts with @handoffkit/core.",
    href: "#javascript",
  },
];

const pythonTeam = `from handoffkit import Agent, HandoffProtocol, Team

team = Team(
    agents=[
        Agent("Architect", "Create implementation plans."),
        Agent("Coder", "Implement code from structured state."),
        Agent("Tester", "Review implementation and gaps."),
    ],
    protocol=HandoffProtocol(mode="hybrid_state"),
)

result = team.run("Create a small Python CLI calculator with tests.")
print(result.final_output)
print(f"Handoffs: {len(result.handoffs)}")
for handoff in result.handoffs:
    print(handoff.to_json())
`;

const jsTeam = `import { Agent, HandoffProtocol, Team } from "@handoffkit/core";

const team = new Team({
  agents: [
    new Agent({ name: "Architect", role: "Plan the work." }),
    new Agent({ name: "Coder", role: "Implement the work." }),
    new Agent({ name: "Tester", role: "Verify the work." }),
  ],
  protocol: new HandoffProtocol({ mode: "hybrid_state" }),
});

const result = team.run("Build a small calculator CLI.");
console.log(result.finalOutput);
console.log(result.handoffs[0]?.toJSON());
`;

export default function QuickStartPage() {
  return (
    <DocsShell toc={toc}>
      {/* Hero */}
      <section className="liquid-card relative overflow-hidden p-6 sm:p-8">
        <div className="liquid-blob liquid-blob-blue absolute -right-8 -top-10 h-44 w-44 opacity-50" />
        <div
          className="liquid-blob liquid-blob-soft absolute -bottom-12 left-10 h-36 w-36 opacity-40"
          style={{ animationDelay: "-3s" }}
        />
        <div className="relative z-10">
          <p className="section-label !mb-2">Get Started</p>
          <h1 className="text-[clamp(1.85rem,3.5vw,2.5rem)] font-extrabold tracking-[-0.04em] text-[var(--navy)]">
            Quick Start
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-[var(--navy-muted)]">
            Get a multi-agent handoff running in minutes. Python is the primary
            runtime; TypeScript shares the same contracts via{" "}
            <code className="rounded bg-[rgba(37,99,255,0.08)] px-1.5 py-0.5 font-mono text-sm text-[var(--blue-deep)]">
              @handoffkit/core
            </code>
            . No API keys required for local demos.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <span className="chip">
              <span className="chip-dot" />
              Offline by default
            </span>
            <span className="chip">
              <span className="chip-dot" />
              MIT licensed
            </span>
            <span className="chip">
              <span className="chip-dot" />
              ~5 minutes
            </span>
          </div>
        </div>
      </section>

      {/* Step overview cards */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s) => (
          <a
            key={s.n}
            href={s.href}
            className="liquid-card group block p-4 !rounded-2xl no-underline"
          >
            <div className="relative z-10">
              <span className="mb-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-b from-[#3b82f6] to-[#1d4ed8] text-xs font-bold text-white shadow-[0_6px_14px_-4px_rgba(37,99,255,0.5)]">
                {s.n}
              </span>
              <p className="text-sm font-semibold text-[var(--navy)] group-hover:text-[var(--blue)]">
                {s.title}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--navy-muted)]">
                {s.body}
              </p>
            </div>
          </a>
        ))}
      </div>

      <div className="docs-prose mt-2">
        <h2 id="install" className="!mt-8 flex items-center gap-2">
          <Package size={20} className="text-[var(--blue)]" />
          1. Install
        </h2>
        <p>
          Install the Python package for the full SDK and CLI, or the TypeScript
          package for browser-safe contracts and teams.
        </p>
        <div className="not-prose grid gap-4 lg:grid-cols-2">
          <div className="liquid-panel p-4 sm:p-5">
            <div className="relative z-10">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--navy)]">Python</p>
                <span className="sdk-badge sdk-badge-primary">Primary</span>
              </div>
              <CodeBlock
                code={`pip install handoffkit
handoffkit --version
handoffkit doctor`}
                filename="python"
                language="bash"
              />
            </div>
          </div>
          <div className="liquid-panel p-4 sm:p-5">
            <div className="relative z-10">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--navy)]">
                  TypeScript
                </p>
                <span className="sdk-badge sdk-badge-ready">Ready</span>
              </div>
              <CodeBlock
                code={`pnpm add @handoffkit/core

# Optional Node filesystem helpers
pnpm add @handoffkit/node`}
                filename="typescript"
                language="bash"
              />
            </div>
          </div>
        </div>

        <h2 id="first-team" className="flex items-center gap-2">
          <Boxes size={20} className="text-[var(--blue)]" />
          2. Run a team with structured handoffs
        </h2>
        <p>
          Create a sequential team. Each agent after the first receives a
          structured <code>HandoffState</code> via{" "}
          <code>HandoffProtocol(mode=&quot;hybrid_state&quot;)</code>. Offline by
          default with the built-in Echo provider — no API keys needed.
        </p>
        <div className="not-prose min-w-0">
          <CodeBlock
            code={pythonTeam}
            filename="quickstart.py"
            language="python"
          />
        </div>

        <div className="not-prose liquid-panel my-5 p-4 sm:p-5">
          <div className="relative z-10">
            <p className="mb-3 text-sm font-semibold text-[var(--navy)]">
              What you get
            </p>
            <ul className="space-y-2 text-sm text-[var(--navy-muted)]">
              {[
                "Three agents run in order: Architect → Coder → Tester",
                "Structured handoffs between each step (not free-text soup)",
                "JSON-serializable state you can inspect, store, and replay",
                "Works offline for local demos and CI",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <CheckCircle2
                    size={16}
                    className="mt-0.5 shrink-0 text-[var(--blue)]"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <h2 id="cli-showcase" className="flex items-center gap-2">
          <Terminal size={20} className="text-[var(--blue)]" />
          3. Try a real showcase from the CLI
        </h2>
        <p>
          The CLI ships with the Python package. Run offline showcases, then
          render a report from the latest run.
        </p>
        <div className="not-prose min-w-0">
          <CodeBlock
            code={`handoffkit demos
handoffkit showcase coding-review
handoffkit report runs/latest`}
            filename="terminal"
            language="bash"
          />
        </div>
        <p>Or scaffold an editable project you can modify:</p>
        <div className="not-prose min-w-0">
          <CodeBlock
            code={`handoffkit init coding-review
cd coding-review
python coding_review.py
handoffkit report runs/latest`}
            filename="scaffold"
            language="bash"
          />
        </div>

        <h2 id="javascript" className="flex items-center gap-2">
          <Code2 size={20} className="text-[var(--blue)]" />
          4. Same flow in TypeScript
        </h2>
        <p>
          Wire format stays <code>snake_case</code>; JS properties use camelCase
          in memory. Shared fixtures keep Python and TypeScript in sync.
        </p>
        <div className="not-prose min-w-0">
          <CodeBlock
            code={jsTeam}
            filename="quickstart.js"
            language="javascript"
          />
        </div>

        <h2 id="next">What’s next</h2>
        <div className="not-prose mt-4 grid gap-3 sm:grid-cols-3">
          {[
            {
              href: "/docs/first-agent",
              title: "Your First Agent",
              body: "Single-agent runs and explicit handoff transfer.",
            },
            {
              href: "/docs/guides/state",
              title: "State Management",
              body: "HandoffState fields, validation, and quality scores.",
            },
            {
              href: "/docs/guides/observability",
              title: "Observability",
              body: "Traces, replay, and human-readable reports.",
            },
          ].map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="liquid-card group block p-5 !rounded-2xl no-underline"
            >
              <div className="relative z-10">
                <p className="font-semibold text-[var(--navy)] group-hover:text-[var(--blue)]">
                  {card.title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--navy-muted)]">
                  {card.body}
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--blue)]">
                  Continue <ArrowRight size={12} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </DocsShell>
  );
}
