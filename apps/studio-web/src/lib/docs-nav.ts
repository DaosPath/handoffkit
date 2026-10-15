export type DocNavItem = {
  title: string;
  href: string;
};

export type DocNavSection = {
  title: string;
  items: DocNavItem[];
};

export const GITHUB_URL = "https://github.com/DaosPath/handoffkit";
export const DOCS_VERSION = "1.12.0";

export const docsNav: DocNavSection[] = [
  {
    title: "Get Started",
    items: [
      { title: "Introduction", href: "/docs" },
      { title: "Quick Start", href: "/docs/quick-start" },
      { title: "Installation", href: "/docs/installation" },
      { title: "Your First Agent", href: "/docs/first-agent" },
      { title: "Core Concepts", href: "/docs/core-concepts" },
    ],
  },
  {
    title: "Guides",
    items: [
      { title: "Agents & Steps", href: "/docs/guides/agents-steps" },
      { title: "State Management", href: "/docs/guides/state" },
      { title: "Routing", href: "/docs/guides/routing" },
      { title: "Tools & Integrations", href: "/docs/guides/tools" },
      { title: "Observability", href: "/docs/guides/observability" },
      { title: "Deploy to Production", href: "/docs/guides/production" },
    ],
  },
  {
    title: "Reference",
    items: [
      { title: "API Reference", href: "/docs/reference/api" },
      { title: "CLI Reference", href: "/docs/reference/cli" },
      { title: "Configuration", href: "/docs/reference/configuration" },
      { title: "Events", href: "/docs/reference/events" },
    ],
  },
];

export const topNav = [
  { title: "Docs", href: "/docs" },
  { title: "API Reference", href: "/docs/reference/api" },
  { title: "Guides", href: "/docs/guides/agents-steps" },
  { title: "Examples", href: "/docs/examples" },
  { title: "Changelog", href: "/docs/changelog" },
];

export function findDocTitle(pathname: string): string {
  for (const section of docsNav) {
    for (const item of section.items) {
      if (item.href === pathname) return item.title;
    }
  }
  if (pathname === "/docs/examples") return "Examples";
  if (pathname === "/docs/changelog") return "Changelog";
  return "Documentation";
}

export function getAdjacentDocs(pathname: string): {
  prev: DocNavItem | null;
  next: DocNavItem | null;
} {
  const flat = docsNav.flatMap((s) => s.items);
  const idx = flat.findIndex((i) => i.href === pathname);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? flat[idx - 1] : null,
    next: idx < flat.length - 1 ? flat[idx + 1] : null,
  };
}
