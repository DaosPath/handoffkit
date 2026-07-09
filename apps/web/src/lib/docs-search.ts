import { docsNav } from "./docs-nav";

export type SearchEntry = {
  id: string;
  title: string;
  href: string;
  section: string;
  description: string;
  keywords: string[];
};

/** Searchable documentation index (titles + keywords for client search). */
export const searchIndex: SearchEntry[] = [
  {
    id: "intro",
    title: "Introduction",
    href: "/docs",
    section: "Get Started",
    description:
      "What is Handoff Kit — structured handoffs for multi-agent systems.",
    keywords: [
      "welcome",
      "overview",
      "handoff kit",
      "multi-agent",
      "orchestrate",
      "python",
      "typescript",
    ],
  },
  {
    id: "quick-start",
    title: "Quick Start",
    href: "/docs/quick-start",
    section: "Get Started",
    description: "Install and run your first team in minutes.",
    keywords: ["install", "pip", "pnpm", "team", "demo", "first steps", "tutorial"],
  },
  {
    id: "installation",
    title: "Installation",
    href: "/docs/installation",
    section: "Get Started",
    description: "Python, TypeScript, and future Rust / C++ runtimes.",
    keywords: [
      "pip install",
      "pypi",
      "npm",
      "@handoffkit/core",
      "@handoffkit/node",
      "requirements",
      "rust",
      "c++",
    ],
  },
  {
    id: "first-agent",
    title: "Your First Agent",
    href: "/docs/first-agent",
    section: "Get Started",
    description: "Single agents, explicit transfers, and validation.",
    keywords: ["agent", "transfer", "validate", "handoff", "protocol"],
  },
  {
    id: "core-concepts",
    title: "Core Concepts",
    href: "/docs/core-concepts",
    section: "Get Started",
    description: "HandoffState, protocols, teams, recipes, traces, and reports.",
    keywords: [
      "handoffstate",
      "protocol",
      "hybrid_state",
      "team",
      "recipe",
      "trace",
      "replay",
      "contracts",
    ],
  },
  {
    id: "agents-steps",
    title: "Agents & Steps",
    href: "/docs/guides/agents-steps",
    section: "Guides",
    description: "Agents, sequential teams, recipe steps, and async runtime.",
    keywords: ["agent", "team", "recipe", "async", "arun", "steps"],
  },
  {
    id: "state",
    title: "State Management",
    href: "/docs/guides/state",
    section: "Guides",
    description: "HandoffState fields, serialize, validate, and quality scores.",
    keywords: [
      "state",
      "to_dict",
      "tojson",
      "validate",
      "quality",
      "from_agent",
      "to_agent",
      "decisions",
    ],
  },
  {
    id: "routing",
    title: "Routing",
    href: "/docs/guides/routing",
    section: "Guides",
    description: "Team order, protocol modes, and explicit transfers.",
    keywords: [
      "routing",
      "protocol modes",
      "natural",
      "compressed",
      "hybrid_min",
      "hybrid_state",
      "transfer",
    ],
  },
  {
    id: "tools",
    title: "Tools & Integrations",
    href: "/docs/guides/tools",
    section: "Guides",
    description: "Tools, providers, and provider tool adapters.",
    keywords: [
      "tool",
      "registry",
      "provider",
      "openai",
      "ollama",
      "adapter",
      "definetool",
    ],
  },
  {
    id: "observability",
    title: "Observability",
    href: "/docs/guides/observability",
    section: "Guides",
    description: "Run traces, replay, reports, and evaluation.",
    keywords: [
      "trace",
      "replay",
      "report",
      "timeline",
      "evaluation",
      "audit",
      "filetracestore",
    ],
  },
  {
    id: "production",
    title: "Deploy to Production",
    href: "/docs/guides/production",
    section: "Guides",
    description: "Production checklist, secrets, offline CI, and quality gates.",
    keywords: ["production", "deploy", "ci", "keys", "secrets", "quality gates"],
  },
  {
    id: "api",
    title: "API Reference",
    href: "/docs/reference/api",
    section: "Reference",
    description: "Stable Python and TypeScript public API surfaces.",
    keywords: [
      "api",
      "exports",
      "agent",
      "team",
      "handoffstate",
      "runtrace",
      "public api",
    ],
  },
  {
    id: "cli",
    title: "CLI Reference",
    href: "/docs/reference/cli",
    section: "Reference",
    description: "handoffkit CLI: demos, showcases, report, providers, keys.",
    keywords: [
      "cli",
      "handoffkit",
      "showcase",
      "demo",
      "report",
      "init",
      "doctor",
      "providers",
      "keys",
    ],
  },
  {
    id: "configuration",
    title: "Configuration",
    href: "/docs/reference/configuration",
    section: "Reference",
    description: "Environment variables, protocol defaults, providers, paths.",
    keywords: ["config", "env", "api key", "protocol", "base url", "traces path"],
  },
  {
    id: "events",
    title: "Events",
    href: "/docs/reference/events",
    section: "Reference",
    description: "TraceEvent, TraceStep, and run timelines.",
    keywords: ["events", "traceevent", "tracestep", "timeline", "logs"],
  },
  {
    id: "examples",
    title: "Examples",
    href: "/docs/examples",
    section: "Examples",
    description: "CLI showcases and monorepo Python / JS examples.",
    keywords: [
      "examples",
      "showcase",
      "coding-review",
      "support",
      "research",
      "demo",
    ],
  },
  {
    id: "changelog",
    title: "Changelog",
    href: "/docs/changelog",
    section: "Changelog",
    description: "Version highlights and runtime roadmap.",
    keywords: ["changelog", "version", "1.12", "release", "roadmap"],
  },
];

// Keep index aligned with nav (extra pages already included above)
void docsNav;

export type SearchResult = SearchEntry & {
  score: number;
};

function scoreEntry(entry: SearchEntry, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const title = entry.title.toLowerCase();
  const desc = entry.description.toLowerCase();
  const section = entry.section.toLowerCase();
  const keywords = entry.keywords.map((k) => k.toLowerCase());
  const haystack = [title, desc, section, ...keywords].join(" ");

  let score = 0;

  if (title === q) score += 100;
  else if (title.startsWith(q)) score += 70;
  else if (title.includes(q)) score += 45;

  if (section.includes(q)) score += 12;

  for (const kw of keywords) {
    if (kw === q) score += 40;
    else if (kw.startsWith(q)) score += 22;
    else if (kw.includes(q)) score += 12;
  }

  if (desc.includes(q)) score += 10;

  // Multi-word: require all tokens somewhere
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const all = tokens.every((t) => haystack.includes(t));
    if (!all) return 0;
    score += tokens.length * 6;
  }

  return score;
}

export function searchDocs(query: string, limit = 8): SearchResult[] {
  const q = query.trim();
  if (!q) {
    // Empty query → suggested starter pages
    return searchIndex.slice(0, 6).map((e) => ({ ...e, score: 0 }));
  }

  return searchIndex
    .map((entry) => ({ ...entry, score: scoreEntry(entry, q) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}

export function getSearchShortcutLabel(): string {
  if (typeof navigator === "undefined") return "⌘K";
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
  return isMac ? "⌘K" : "Ctrl K";
}
