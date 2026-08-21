import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs/DocsShell";
import { CodeBlock } from "@/components/docs/CodeBlock";

export const metadata: Metadata = { title: "Installation" };

const toc = [
  { id: "python", title: "Python" },
  { id: "javascript", title: "JavaScript" },
  { id: "requirements", title: "Requirements" },
  { id: "verify", title: "Verify" },
  { id: "future", title: "Rust & C++" },
];

export default function InstallationPage() {
  return (
    <DocsShell toc={toc}>
      <div className="docs-prose">
        <p className="section-label">Get Started</p>
        <h1 className="!mt-0 text-[clamp(1.75rem,3vw,2.35rem)] font-extrabold tracking-[-0.035em] text-[var(--navy)]">
          Installation
        </h1>
        <p>
          Install the runtime you need. Python publishes to PyPI as{" "}
          <code>handoffkit</code>. JavaScript publishes as{" "}
          <code>@handoffkit/core</code> (browser-safe) and{" "}
          <code>@handoffkit/node</code> (filesystem helpers).
        </p>

        <h2 id="python">Python</h2>
        <CodeBlock
          code={`pip install handoffkit

# Optional: verify CLI
handoffkit --version
handoffkit doctor`}
          filename="python"
          language="bash"
        />
        <p>
          Supported Python versions: <strong>3.10 – 3.14</strong>. The core package
          has <strong>no runtime dependencies</strong>. Offline demos use
          deterministic local providers.
        </p>

        <h2 id="javascript">JavaScript / TypeScript</h2>
        <CodeBlock
          code={`# Browser-safe contracts + runtime
pnpm add @handoffkit/core

# Node-only: FileTraceStore, writeReportFiles
pnpm add @handoffkit/node`}
          filename="javascript"
          language="bash"
        />
        <p>
          <code>@handoffkit/core</code> is ESM-first and dependency-free. Use it in
          Node, browsers, Next.js, Vite, Workers, Deno, and Bun. Filesystem report
          helpers live in <code>@handoffkit/node</code>.
        </p>

        <h2 id="requirements">Requirements</h2>
        <ul>
          <li>Python 3.10+ for the primary SDK and CLI</li>
          <li>Node 18+ recommended for the JS packages</li>
          <li>No cloud accounts required for offline demos</li>
          <li>Optional provider API keys only for live model runs</li>
        </ul>

        <h2 id="verify">Verify install</h2>
        <CodeBlock
          code={`python -c "import handoffkit; print(handoffkit.__version__)"
handoffkit demo
handoffkit api`}
          filename="verify"
          language="bash"
        />

        <h2 id="future">Rust &amp; C++ (future)</h2>
        <div className="not-prose liquid-panel my-4 p-5">
          <div className="relative z-10 space-y-3 text-sm text-[var(--navy-muted)]">
            <p>
              <strong className="text-[var(--navy)]">Rust</strong> — contract
              structs and cross-runtime parity tests exist under{" "}
              <code className="rounded bg-[rgba(37,99,255,0.08)] px-1.5 py-0.5 font-mono text-xs text-[var(--blue-deep)]">
                packages/rust
              </code>
              . Not published to crates.io yet. Full agent runtime is planned after
              Python/JS stabilize further.
            </p>
            <p>
              <strong className="text-[var(--navy)]">C++</strong> — headers and
              JSON contract validation live under{" "}
              <code className="rounded bg-[rgba(37,99,255,0.08)] px-1.5 py-0.5 font-mono text-xs text-[var(--blue-deep)]">
                packages/cpp
              </code>
              . Not published to package managers. Native agent runtime is planned.
            </p>
            <p>
              Both share the same canonical fixtures in{" "}
              <code className="rounded bg-[rgba(37,99,255,0.08)] px-1.5 py-0.5 font-mono text-xs text-[var(--blue-deep)]">
                packages/contracts
              </code>
              .
            </p>
          </div>
        </div>

        <p>
          Next: <Link href="/docs/quick-start">Quick Start</Link> or{" "}
          <Link href="/docs/first-agent">Your First Agent</Link>.
        </p>
      </div>
    </DocsShell>
  );
}
