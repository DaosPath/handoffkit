import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs/DocsShell";
import { CodeBlock } from "@/components/docs/CodeBlock";

export const metadata: Metadata = { title: "Tools & Integrations" };

const toc = [
  { id: "python-tools", title: "Python tools" },
  { id: "js-tools", title: "JS tools" },
  { id: "providers", title: "Providers" },
  { id: "adapters", title: "Tool adapters" },
];

export default function ToolsPage() {
  return (
    <DocsShell toc={toc}>
      <div className="docs-prose">
        <p className="section-label">Guides</p>
        <h1 className="!mt-0 text-[clamp(1.75rem,3vw,2.35rem)] font-extrabold tracking-[-0.035em] text-[var(--navy)]">
          Tools &amp; Integrations
        </h1>
        <p>
          Connect models, tools, and external systems without losing structured
          handoffs. Tool schemas and results are first-class contracts.
        </p>

        <h2 id="python-tools">Python tools</h2>
        <CodeBlock
          code={`from handoffkit import tool, ToolRegistry

@tool
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b

registry = ToolRegistry()
registry.register(add)
result = registry.execute({"name": "add", "arguments": {"a": 1, "b": 2}})
print(result.output)`}
          filename="tools_py.py"
          language="python"
        />

        <h2 id="js-tools">TypeScript tools</h2>
        <CodeBlock
          code={`import { ProviderToolAdapter, defineTool, ToolRegistry } from "@handoffkit/core";

const add = defineTool({
  name: "add",
  description: "Add two numbers.",
  parameters: { type: "object" },
  execute: ({ a, b }) => a + b,
});

const registry = new ToolRegistry([add]);
const adapter = new ProviderToolAdapter();
const openaiTools = adapter.toolsToProviderFormat([add], "openai");
const anthropicTools = adapter.toolsToProviderFormat([add], "anthropic");`}
          filename="tools_js.js"
          language="javascript"
        />

        <h2 id="providers">Providers</h2>
        <p>
          Python includes a provider registry and selectors for local and remote
          models (OpenAI-compatible, Ollama, NVIDIA, OpenRouter, Groq, Grok, and
          more). Live providers are opt-in; demos stay offline by default.
        </p>
        <CodeBlock
          code={`handoffkit providers list
handoffkit keys set OPENAI_API_KEY
# then use ProviderSelector / provider classes in code`}
          filename="providers"
          language="bash"
        />

        <h2 id="adapters">Provider tool adapters</h2>
        <p>
          <code>ProviderToolAdapter</code> normalizes tool schemas and tool-call
          payloads across provider formats so your handoff contracts stay stable.
        </p>

        <p>
          Next: <Link href="/docs/guides/observability">Observability</Link>
        </p>
      </div>
    </DocsShell>
  );
}
