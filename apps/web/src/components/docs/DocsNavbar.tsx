"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { GitHubIcon } from "@/components/icons";
import { DOCS_VERSION, GITHUB_URL, topNav } from "@/lib/docs-nav";
import { DocsSearch } from "./DocsSearch";

type DocsNavbarProps = {
  onMenuToggle: () => void;
  menuOpen: boolean;
};

function isTopNavActive(pathname: string, href: string): boolean {
  if (href === "/docs") {
    return (
      pathname === "/docs" ||
      pathname.startsWith("/docs/quick-start") ||
      pathname.startsWith("/docs/installation") ||
      pathname.startsWith("/docs/first-agent") ||
      pathname.startsWith("/docs/core-concepts")
    );
  }
  if (href === "/docs/guides/agents-steps") {
    return pathname.startsWith("/docs/guides");
  }
  if (href === "/docs/reference/api") {
    return pathname.startsWith("/docs/reference");
  }
  return pathname === href || pathname.startsWith(href + "/");
}

export function DocsNavbar({ onMenuToggle, menuOpen }: DocsNavbarProps) {
  const pathname = usePathname();

  return (
    <header className="docs-header">
      <div className="docs-header-inner">
        {/* Left: menu + brand */}
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={onMenuToggle}
            className="docs-header-icon-btn docs-mobile-menu-btn"
            aria-label={menuOpen ? "Close documentation menu" : "Open documentation menu"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          <Link
            href="/"
            className="flex shrink-0 items-center gap-2.5"
            aria-label="Handoff Kit home"
          >
            <Logo height={28} priority />
            <span className="hidden h-4 w-px bg-[rgba(37,99,255,0.15)] sm:block" />
            <span className="hidden items-center gap-1.5 sm:flex">
              <span className="text-[0.8rem] font-semibold tracking-tight text-[var(--navy)]">
                Docs
              </span>
              <span className="docs-version-pill">v{DOCS_VERSION}</span>
            </span>
          </Link>
        </div>

        {/* Center nav links */}
        <nav className="docs-header-nav" aria-label="Documentation sections">
          {topNav.map((item) => {
            const active = isTopNavActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`docs-header-link ${active ? "docs-header-link-active" : ""}`}
              >
                {active && (
                  <motion.span
                    layoutId="docs-nav-pill"
                    className="docs-header-link-pill"
                    transition={{ type: "spring", stiffness: 380, damping: 34 }}
                  />
                )}
                <span className="relative z-10">{item.title}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right: search + actions */}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-2.5 lg:flex-initial">
          <div className="hidden min-w-0 flex-1 sm:block sm:max-w-none md:max-w-[280px] lg:w-[min(340px,32vw)] lg:flex-none xl:w-[380px]">
            <DocsSearch />
          </div>

          <div className="sm:hidden">
            <DocsSearch iconOnly />
          </div>

          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="docs-header-icon-btn"
            aria-label="GitHub repository"
          >
            <GitHubIcon size={16} />
          </a>
        </div>
      </div>

      {/* Soft bottom edge glow */}
      <div className="docs-header-edge" aria-hidden />
    </header>
  );
}
