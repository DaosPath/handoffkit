import type { Metadata } from "next";
import { DocsShell } from "@/components/docs/DocsShell";
import { CodeBlock } from "@/components/docs/CodeBlock";

export const metadata: Metadata = { title: "CLI Reference" };

const toc = [
  { id: "basics", title: "Basics" },
  { id: "demos", title: "Demos & showcases" },
  { id: "project", title: "Project tools" },
  { id: "providers", title: "Providers & keys" },
];

const commands = [
  { cmd: "handoffkit --version", desc: "Print package version" },
  { cmd: "handoffkit doctor", desc: "Local package diagnostics" },
  { cmd: "handoffkit api", desc: "Show stable API candidates" },
  { cmd: "handoffkit demo", desc: "EchoProvider team demo" },
  { cmd: "handoffkit demo-async", desc: "Async team demo" },
  { cmd: "handoffkit demo-recipe", desc: "Built-in recipe demo" },
  { cmd: "handoffkit demos", desc: "List offline showcases" },
  { cmd: "handoffkit showcase <slug>", desc: "Run a named showcase" },
  { cmd: "handoffkit init <template>", desc: "Scaffold a starter project" },
  { cmd: "handoffkit report <path>", desc: "Render a generated run report" },
  { cmd: "handoffkit validate-report <file>", desc: "Validate a JSON report" },
  { cmd: "handoffkit providers list", desc: "List registered providers" },
  { cmd: "handoffkit keys set|list|delete", desc: "Manage local API keys" },
];

export default function CliReferencePage() {
  return (
    <DocsShell toc={toc}>
      <div className="docs-prose">
        <p className="section-label">Reference</p>
        <h1 className="!mt-0 text-[clamp(1.75rem,3vw,2.35rem)] font-extrabold tracking-[-0.035em] text-[var(--navy)]">
          CLI Reference
        </h1>
        <p>
          The <code>handoffkit</code> CLI ships with the Python package. Use it for
          demos, scaffolding, reports, providers, and local diagnostics.
        </p>

        <h2 id="basics">Basics</h2>
        <CodeBlock
          code={`pip install handoffkit
handoffkit --version
handoffkit doctor
handoffkit api`}
          filename="basics"
          language="bash"
        />

        <h2 id="demos">Demos &amp; showcases</h2>
        <CodeBlock
          code={`handoffkit demo
handoffkit demo-trace
handoffkit demo-replay
handoffkit demos
handoffkit showcase coding-review
handoffkit showcase support-escalation
handoffkit showcase research-workflow
handoffkit demo-media
handoffkit demo-fusion`}
          filename="demos"
          language="bash"
        />

        <h2 id="project">Project tools</h2>
        <CodeBlock
          code={`handoffkit init coding-review
handoffkit report runs/latest
handoffkit validate-report runs/latest/report.json
handoffkit create-extension my_ext`}
          filename="project"
          language="bash"
        />

        <h2 id="providers">Providers &amp; keys</h2>
        <CodeBlock
          code={`handoffkit providers list
handoffkit keys set OPENAI_API_KEY
handoffkit keys list`}
          filename="providers"
          language="bash"
        />

        <div className="not-prose mt-6 overflow-hidden rounded-2xl">
          <div className="liquid-panel overflow-x-auto p-0">
            <table className="relative z-10 w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-[rgba(37,99,255,0.1)] text-[var(--navy)]">
                  <th className="px-5 py-3 font-semibold">Command</th>
                  <th className="px-5 py-3 font-semibold">Description</th>
                </tr>
              </thead>
              <tbody>
                {commands.map((row) => (
                  <tr
                    key={row.cmd}
                    className="border-b border-[rgba(37,99,255,0.06)] text-[var(--navy-muted)] last:border-0"
                  >
                    <td className="px-5 py-2.5 font-mono text-xs text-[var(--blue-deep)]">
                      {row.cmd}
                    </td>
                    <td className="px-5 py-2.5">{row.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DocsShell>
  );
}
