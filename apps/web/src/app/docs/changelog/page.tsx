import type { Metadata } from "next";
import { DocsShell } from "@/components/docs/DocsShell";

export const metadata: Metadata = { title: "Changelog" };

const toc = [
  { id: "current", title: "1.12.x" },
  { id: "recent", title: "Recent highlights" },
  { id: "roadmap", title: "Roadmap" },
];

const highlights = [
  {
    version: "1.12.0",
    notes: "Current Python / core line with stable public API surface.",
  },
  {
    version: "1.9.0",
    notes: "Browser-safe @handoffkit/core plus Node-only @handoffkit/node.",
  },
  {
    version: "1.8.x",
    notes: "Installed-package-safe contract parity reports; shared fixtures.",
  },
  {
    version: "1.7.0",
    notes: "Shared Python + JavaScript contracts with canonical JSON fixtures.",
  },
  {
    version: "1.6.0",
    notes: "JavaScript core: async runtime, provider tools, traces, reports.",
  },
  {
    version: "1.5.0",
    notes: "Media workflow contracts for dubbing demos.",
  },
];

export default function ChangelogPage() {
  return (
    <DocsShell toc={toc}>
      <div className="docs-prose">
        <p className="section-label">Changelog</p>
        <h1 className="!mt-0 text-[clamp(1.75rem,3vw,2.35rem)] font-extrabold tracking-[-0.035em] text-[var(--navy)]">
          Changelog
        </h1>
        <p>
          High-level product notes for documentation. For full package history see
          the repository release notes and{" "}
          <code>packages/python/CHANGELOG.md</code>.
        </p>

        <h2 id="current">Current</h2>
        <p>
          Documentation targets Handoff Kit <strong>1.12.0</strong> (Python{" "}
          <code>handoffkit</code> / JS core version alignment in monorepo).
        </p>

        <h2 id="recent">Recent highlights</h2>
        <div className="not-prose mt-4 space-y-3">
          {highlights.map((h) => (
            <div key={h.version} className="liquid-card p-4 !rounded-2xl">
              <div className="relative z-10">
                <p className="font-mono text-sm font-bold text-[var(--blue)]">
                  {h.version}
                </p>
                <p className="mt-1 text-sm text-[var(--navy-muted)]">{h.notes}</p>
              </div>
            </div>
          ))}
        </div>

        <h2 id="roadmap">Runtime roadmap</h2>
        <ul>
          <li>
            <strong>Python</strong> — primary runtime (stable)
          </li>
          <li>
            <strong>TypeScript</strong> — contract + agent runtime (stable core)
          </li>
          <li>
            <strong>Rust</strong> — contracts today; full agent runtime planned
          </li>
          <li>
            <strong>C++</strong> — contracts today; full agent runtime planned
          </li>
        </ul>
      </div>
    </DocsShell>
  );
}
