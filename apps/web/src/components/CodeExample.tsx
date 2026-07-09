"use client";

import { m } from "framer-motion";
import { easeOut, fadeUp, stagger, viewportOnce } from "@/lib/motion";

const codeLines: { tokens: { t: string; c?: string }[] }[] = [
  {
    tokens: [
      { t: "from", c: "tok-kw" },
      { t: " handoffkit ", c: "" },
      { t: "import", c: "tok-kw" },
      { t: " Orchestrator, step, State", c: "" },
    ],
  },
  { tokens: [{ t: "", c: "" }] },
  {
    tokens: [
      { t: "class", c: "tok-kw" },
      { t: " ", c: "" },
      { t: "MyState", c: "tok-cls" },
      { t: "(", c: "tok-op" },
      { t: "State", c: "tok-cls" },
      { t: "):", c: "tok-op" },
    ],
  },
  {
    tokens: [
      { t: "    topic: ", c: "" },
      { t: "str", c: "tok-cls" },
    ],
  },
  {
    tokens: [
      { t: "    findings: ", c: "" },
      { t: "list", c: "tok-cls" },
      { t: "[", c: "tok-op" },
      { t: "str", c: "tok-cls" },
      { t: "] = []", c: "tok-op" },
    ],
  },
  {
    tokens: [
      { t: "    summary: ", c: "" },
      { t: "str", c: "tok-cls" },
      { t: ' = ""', c: "tok-str" },
    ],
  },
  { tokens: [{ t: "", c: "" }] },
  {
    tokens: [
      { t: "@", c: "tok-op" },
      { t: "step", c: "tok-fn" },
      { t: "(", c: "tok-op" },
      { t: "name", c: "" },
      { t: "=", c: "tok-op" },
      { t: '"research"', c: "tok-str" },
      { t: ", ", c: "" },
      { t: "agent", c: "" },
      { t: "=", c: "tok-op" },
      { t: '"researcher"', c: "tok-str" },
      { t: ")", c: "tok-op" },
    ],
  },
  {
    tokens: [
      { t: "def", c: "tok-kw" },
      { t: " ", c: "" },
      { t: "research", c: "tok-fn" },
      { t: "(state: ", c: "tok-op" },
      { t: "MyState", c: "tok-cls" },
      { t: ") -> ", c: "tok-op" },
      { t: "None", c: "tok-cls" },
      { t: ":", c: "tok-op" },
    ],
  },
  {
    tokens: [
      { t: "    state.findings = ", c: "" },
      { t: "search_web", c: "tok-fn" },
      { t: "(state.topic)", c: "tok-op" },
    ],
  },
  { tokens: [{ t: "", c: "" }] },
  {
    tokens: [
      { t: "@", c: "tok-op" },
      { t: "step", c: "tok-fn" },
      { t: "(", c: "tok-op" },
      { t: "name", c: "" },
      { t: "=", c: "tok-op" },
      { t: '"summarize"', c: "tok-str" },
      { t: ", ", c: "" },
      { t: "agent", c: "" },
      { t: "=", c: "tok-op" },
      { t: '"writer"', c: "tok-str" },
      { t: ")", c: "tok-op" },
    ],
  },
  {
    tokens: [
      { t: "def", c: "tok-kw" },
      { t: " ", c: "" },
      { t: "summarize", c: "tok-fn" },
      { t: "(state: ", c: "tok-op" },
      { t: "MyState", c: "tok-cls" },
      { t: ") -> ", c: "tok-op" },
      { t: "None", c: "tok-cls" },
      { t: ":", c: "tok-op" },
    ],
  },
  {
    tokens: [
      { t: "    state.summary = ", c: "" },
      { t: "write_summary", c: "tok-fn" },
      { t: "(state.findings)", c: "tok-op" },
    ],
  },
  { tokens: [{ t: "", c: "" }] },
  {
    tokens: [
      { t: "orchestrator = ", c: "" },
      { t: "Orchestrator", c: "tok-cls" },
      { t: "(state=", c: "tok-op" },
      { t: "MyState", c: "tok-cls" },
      { t: ")", c: "tok-op" },
    ],
  },
  {
    tokens: [
      { t: "orchestrator.", c: "" },
      { t: "add_step", c: "tok-fn" },
      { t: "(research)", c: "tok-op" },
    ],
  },
  {
    tokens: [
      { t: "orchestrator.", c: "" },
      { t: "add_step", c: "tok-fn" },
      { t: "(summarize)", c: "tok-op" },
    ],
  },
  { tokens: [{ t: "", c: "" }] },
  {
    tokens: [
      { t: "result = orchestrator.", c: "" },
      { t: "run", c: "tok-fn" },
      { t: "({", c: "tok-op" },
    ],
  },
  {
    tokens: [
      { t: '    "topic"', c: "tok-str" },
      { t: ": ", c: "tok-op" },
      { t: '"Multi-agent systems"', c: "tok-str" },
    ],
  },
  { tokens: [{ t: "})", c: "tok-op" }] },
];

const steps = [
  {
    n: "1",
    title: "Define shared state",
    body: "Create a schema for data every agent can access.",
  },
  {
    n: "2",
    title: "Add agents & steps",
    body: "Register specialized agents and their responsibilities.",
  },
  {
    n: "3",
    title: "Set routing policies",
    body: "Decide how work flows between agents.",
  },
  {
    n: "4",
    title: "Run & observe",
    body: "Execute, monitor, and collect rich event logs.",
  },
  {
    n: "5",
    title: "Inspect & improve",
    body: "Replay runs, audit trails, and iterate.",
  },
];

export function CodeExample() {
  return (
    <section id="docs" className="relative px-4 py-20 sm:px-6 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <m.div
          variants={fadeUp}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          transition={easeOut}
          className="liquid-surface p-5 sm:p-8 lg:p-10"
        >
          <div className="relative z-10 grid gap-10 lg:grid-cols-2 lg:gap-12">
            <div>
              <h2 className="section-title mb-6 text-[clamp(1.6rem,3vw,2.25rem)]">
                Define. Orchestrate. Handoff.
              </h2>

              <div className="code-block w-full min-w-0">
                <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
                  <span className="ml-3 font-mono text-[0.7rem] text-slate-500">
                    orchestrator.py
                  </span>
                </div>
                <pre>
                  <code className="block w-full min-w-0">
                    {codeLines.map((line, i) => (
                      <div key={i} className="code-line">
                        <span className="code-ln">{i + 1}</span>
                        <span>
                          {line.tokens.map((tok, j) =>
                            tok.c ? (
                              <span key={j} className={tok.c}>
                                {tok.t}
                              </span>
                            ) : (
                              <span key={j}>{tok.t}</span>
                            )
                          )}
                        </span>
                      </div>
                    ))}
                  </code>
                </pre>
              </div>
            </div>

            <div>
              <p className="section-label">How it works</p>
              <h3 className="mb-8 text-2xl font-bold tracking-tight text-[var(--navy)]">
                From schema to production run
              </h3>

              <ol className="flex flex-col gap-4">
                {steps.map((step, i) => (
                  <m.li
                    key={step.n}
                    variants={fadeUp}
                    initial="hidden"
                    whileInView="show"
                    viewport={viewportOnce}
                    transition={stagger(i, 0.05)}
                    className="liquid-card flex gap-4 p-4 sm:p-5"
                  >
                    <div className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#3b82f6] to-[#1d4ed8] text-sm font-bold text-white shadow-[0_6px_16px_-4px_rgba(37,99,255,0.5)]">
                      {step.n}
                    </div>
                    <div className="relative z-10">
                      <p className="font-semibold text-[var(--navy)]">
                        {step.title}
                      </p>
                      <p className="mt-0.5 text-sm text-[var(--navy-muted)]">
                        {step.body}
                      </p>
                    </div>
                  </m.li>
                ))}
              </ol>
            </div>
          </div>
        </m.div>
      </div>
    </section>
  );
}
