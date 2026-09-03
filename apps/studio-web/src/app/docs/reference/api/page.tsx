import type { Metadata } from "next";
import { DocsShell } from "@/components/docs/DocsShell";

export const metadata: Metadata = { title: "API Reference" };

const toc = [
  { id: "python", title: "Python surface" },
  { id: "js", title: "JavaScript surface" },
  { id: "future", title: "Rust & C++" },
];

const pythonGroups = [
  {
    title: "Core workflow",
    items: ["Agent", "Team", "TeamRunResult", "HandoffState", "HandoffProtocol"],
  },
  {
    title: "Tools & providers",
    items: [
      "Tool",
      "tool",
      "ToolCall",
      "ToolResult",
      "ToolRegistry",
      "ProviderToolAdapter",
      "ProviderToolFormat",
    ],
  },
  {
    title: "Validation & quality",
    items: [
      "HandoffStateValidator",
      "ValidationReport",
      "HandoffQualityEvaluator",
      "WorkflowEvaluator",
      "StructuredOutputSchema",
    ],
  },
  {
    title: "Recipes & extensions",
    items: ["Recipe", "RecipeStep", "RecipeRunner", "Extension", "ExtensionRegistry"],
  },
  {
    title: "Trace, replay, reports",
    items: [
      "RunTrace",
      "TraceStep",
      "TraceEvent",
      "FileTraceStore",
      "ReplayRunner",
      "write_report_files",
      "load_report_json",
    ],
  },
];

const jsItems = [
  "HandoffState",
  "HandoffProtocol",
  "Agent",
  "Team",
  "ValidationReport",
  "HandoffQualityEvaluator",
  "RunTrace",
  "ReplayRunner",
  "ProviderToolAdapter",
  "ToolRegistry",
  "defineTool",
  "EchoProvider",
  "OpenAIProvider",
  "OllamaProvider",
];

export default function ApiReferencePage() {
  return (
    <DocsShell toc={toc}>
      <div className="docs-prose">
        <p className="section-label">Reference</p>
        <h1 className="!mt-0 text-[clamp(1.75rem,3vw,2.35rem)] font-extrabold tracking-[-0.035em] text-[var(--navy)]">
          API Reference
        </h1>
        <p>
          Stable public surfaces for Handoff Kit <strong>1.x</strong>. Python
          symbols match <code>handoffkit</code> package exports. JavaScript
          symbols match <code>@handoffkit/core</code> (plus Node helpers in{" "}
          <code>@handoffkit/node</code>).
        </p>

        <h2 id="python">Python public API</h2>
        <div className="not-prose mt-4 space-y-4">
          {pythonGroups.map((g) => (
            <div key={g.title} className="liquid-panel p-5">
              <h3 className="relative z-10 mb-3 text-sm font-bold text-[var(--navy)]">
                {g.title}
              </h3>
              <div className="relative z-10 flex flex-wrap gap-2">
                {g.items.map((name) => (
                  <code
                    key={name}
                    className="rounded-lg border border-[rgba(37,99,255,0.12)] bg-white/70 px-2.5 py-1 font-mono text-xs text-[var(--blue-deep)]"
                  >
                    {name}
                  </code>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4">
          CLI discovery: run <code>handoffkit api</code> for the package’s listed
          stable API candidates.
        </p>

        <h2 id="js">JavaScript / TypeScript</h2>
        <div className="not-prose liquid-panel my-4 p-5">
          <div className="relative z-10 flex flex-wrap gap-2">
            {jsItems.map((name) => (
              <code
                key={name}
                className="rounded-lg border border-[rgba(37,99,255,0.12)] bg-white/70 px-2.5 py-1 font-mono text-xs text-[var(--blue-deep)]"
              >
                {name}
              </code>
            ))}
          </div>
        </div>
        <p>
          Node-only: <code>FileTraceStore</code>, <code>writeReportFiles</code> from{" "}
          <code>@handoffkit/node</code>.
        </p>

        <h2 id="future">Rust &amp; C++ (future)</h2>
        <p>
          Contract-level types for <code>HandoffState</code> and{" "}
          <code>RunTrace</code> exist for parity testing. Full agent/runtime APIs
          are planned and not published yet. Prefer Python or TypeScript for
          production workflows today.
        </p>
      </div>
    </DocsShell>
  );
}
