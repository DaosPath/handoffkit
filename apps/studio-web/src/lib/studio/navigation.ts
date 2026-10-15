export const studioNav = [
  { label: "Overview", href: "/" },
  { label: "Demos", href: "/demos" },
  { label: "Clinical Lab", href: "/demos/clinical-lab" },
  { label: "Security", href: "/studio/security" },
  { label: "Browser", href: "/studio/browser" },
  { label: "Replay", href: "/demos#replay" },
  { label: "Reports", href: "/demos#reports" },
  {
    label: "GitHub",
    href: "https://github.com/DaosPath/handoffkit",
    external: true,
  },
] as const;

export type StudioNavLabel = (typeof studioNav)[number]["label"];
