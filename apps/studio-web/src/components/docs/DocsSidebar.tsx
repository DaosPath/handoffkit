"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, BookOpen } from "lucide-react";
import { Logo } from "@/components/Logo";
import { docsNav, GITHUB_URL } from "@/lib/docs-nav";

type DocsSidebarProps = {
  mobile?: boolean;
  onNavigate?: () => void;
};

export function DocsSidebar({ mobile = false, onNavigate }: DocsSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className={`relative z-10 flex h-full flex-col ${mobile ? "" : ""}`}>
      <div className="liquid-panel flex h-full flex-col p-4">
        <div className="relative z-10 mb-5 flex items-center gap-2 px-1">
          {mobile && (
            <Link href="/" onClick={onNavigate} className="mr-1">
              <Logo height={24} />
            </Link>
          )}
          <BookOpen size={16} className="text-[var(--blue)]" />
          <h2 className="text-sm font-bold tracking-tight text-[var(--navy)]">
            Documentation
          </h2>
        </div>

        <nav className="relative z-10 flex-1 space-y-5 overflow-y-auto pr-1">
          {docsNav.map((section) => (
            <div key={section.title}>
              <p className="mb-1.5 px-3 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-[var(--navy-muted)]/80">
                {section.title}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        className={`doc-sidebar-item ${
                          active ? "doc-sidebar-item-active" : ""
                        }`}
                      >
                        {item.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="liquid-card relative z-10 mt-4 flex items-center justify-between gap-3 p-4 !rounded-2xl no-underline"
        >
          <div className="relative z-10">
            <p className="text-sm font-semibold text-[var(--navy)]">Star on GitHub</p>
            <p className="text-xs text-[var(--navy-muted)]">Support the project</p>
          </div>
          <span className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(37,99,255,0.1)] text-[var(--blue)]">
            <ArrowUpRight size={16} />
          </span>
        </a>
      </div>
    </aside>
  );
}
