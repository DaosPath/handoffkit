"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { DocsNavbar } from "./DocsNavbar";
import { DocsSidebar } from "./DocsSidebar";
import { DocsToc, type TocItem } from "./DocsToc";
import { DocsPager } from "./DocsPager";
import { Logo } from "@/components/Logo";
import { usePathname } from "next/navigation";

type DocsShellProps = {
  children: React.ReactNode;
  toc?: TocItem[];
};

export function DocsShell({ children, toc = [] }: DocsShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <div className="relative min-h-screen">
      {/* Ambient blobs */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="liquid-blob liquid-blob-blue absolute -left-32 top-20 h-80 w-80 opacity-30" />
        <div
          className="liquid-blob liquid-blob-soft absolute -right-24 top-60 h-96 w-96 opacity-35"
          style={{ animationDelay: "-5s" }}
        />
        <div
          className="liquid-blob liquid-blob-white absolute bottom-20 left-1/3 h-64 w-64 opacity-40"
          style={{ animationDelay: "-2s" }}
        />
      </div>

      <DocsNavbar menuOpen={menuOpen} onMenuToggle={() => setMenuOpen((v) => !v)} />

      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_240px]">
        <div className="docs-sidebar-col sticky top-20 hidden max-h-[calc(100vh-6rem)] self-start lg:block">
          <DocsSidebar />
        </div>

        <main className="min-w-0 pb-16">
          {children}
          <DocsPager pathname={pathname} />
        </main>

        <div className="docs-toc-col sticky top-20 hidden max-h-[calc(100vh-6rem)] self-start overflow-y-auto xl:block">
          {toc.length > 0 && <DocsToc items={toc} />}
        </div>
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-[rgba(7,20,47,0.35)] backdrop-blur-sm lg:hidden"
              onClick={() => setMenuOpen(false)}
            />
            <motion.div
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="fixed bottom-0 left-0 top-0 z-50 w-[min(320px,88vw)] p-3 lg:hidden"
            >
              <DocsSidebar mobile onNavigate={() => setMenuOpen(false)} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <footer className="border-t border-[rgba(37,99,255,0.08)] px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-[1440px] flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <Logo height={24} />
          <p className="text-xs text-[var(--navy-muted)]">
            © 2026 Handoff Kit. MIT License. Documentation for Python &amp; TypeScript
            runtimes — Rust &amp; C++ planned.
          </p>
        </div>
      </footer>
    </div>
  );
}
