import type { Metadata } from "next";
import { DocsShell } from "@/components/docs/DocsShell";
import { CodeBlock } from "@/components/docs/CodeBlock";

export const metadata: Metadata = { title: "Configuration" };

const toc = [
  { id: "env", title: "Environment" },
  { id: "protocol", title: "Protocol" },
  { id: "providers", title: "Providers" },
  { id: "traces", title: "Trace paths" },
];

export default function ConfigurationPage() {
  return (
    <DocsShell toc={toc}>
      <div className="docs-prose">
        <p className="section-label">Reference</p>
        <h1 className="!mt-0 text-[clamp(1.75rem,3vw,2.35rem)] font-extrabold tracking-[-0.035em] text-[var(--navy)]">
          Configuration
        </h1>
        <p>
          Handoff Kit stays configuration-light. Prefer explicit constructor
          arguments in code; use environment variables only for secrets and
          optional live providers.
        </p>

        <h2 id="env">Environment variables</h2>
        <ul>
          <li>
            Provider API keys (examples): <code>OPENAI_API_KEY</code>,{" "}
            <code>NVIDIA_API_KEY</code>, and others supported by the provider
            registry
          </li>
          <li>
            Local <code>.env</code> management via <code>handoffkit keys</code>
          </li>
        </ul>

        <h2 id="protocol">Protocol defaults</h2>
        <CodeBlock
          code={`# Recommended production mode
HandoffProtocol(mode="hybrid_state")

# Team default if omitted
Team(agents=[...])  # uses hybrid_state protocol`}
          filename="protocol"
          language="python"
        />

        <h2 id="providers">Provider configuration</h2>
        <p>
          Instantiate providers with model name, base URL, headers, and timeout as
          needed. Adapters do not require vendor SDKs for schema conversion.
        </p>
        <CodeBlock
          code={`// TypeScript example
import { OpenAIProvider, OllamaProvider } from "@handoffkit/core";

const openai = new OpenAIProvider({
  model: "gpt-4o-mini",
  apiKey: process.env.OPENAI_API_KEY,
});

const ollama = new OllamaProvider({
  model: "llama3.1",
  baseUrl: "http://127.0.0.1:11434",
});`}
          filename="providers.ts"
          language="javascript"
        />

        <h2 id="traces">Trace &amp; report paths</h2>
        <p>
          Common convention in examples and CLI: write under{" "}
          <code>runs/latest</code> or a custom output directory. Node users can
          set <code>FileTraceStore</code> root explicitly.
        </p>
        <CodeBlock
          code={`# Python CLI
handoffkit report runs/latest

# Node
await new FileTraceStore({ root: "traces" }).save(trace, "latest");`}
          filename="paths"
          language="bash"
        />
      </div>
    </DocsShell>
  );
}
