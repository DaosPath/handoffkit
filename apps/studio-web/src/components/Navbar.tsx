"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, ArrowRight } from "lucide-react";
import { Logo } from "./Logo";
import { GitHubIcon } from "./icons";

const links = [
  { href: "#features", label: "Features" },
  { href: "/docs", label: "Docs" },
  { href: "/demos", label: "Demos" },
  { href: "#use-cases", label: "Use Cases" },
  {
    href: "https://github.com/DaosPath/handoffkit",
    label: "GitHub",
    external: true,
  },
  { href: "#pricing", label: "Pricing" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 px-4 pt-4 sm:px-6">
      <div className="nav-glass mx-auto flex max-w-6xl items-center justify-between gap-4 rounded-2xl px-4 py-3 sm:px-5">
        <a href="#" className="flex shrink-0 items-center" aria-label="Handoff Kit home">
          <Logo height={30} priority />
        </a>

        <nav className="nav-links-desktop flex items-center gap-1">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              {...(link.external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--navy-muted)] transition-colors hover:bg-white/60 hover:text-[var(--navy)]"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="nav-links-desktop flex items-center gap-2">
          <a
            href="https://github.com/DaosPath/handoffkit"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost"
          >
            <GitHubIcon size={16} />
            Star on GitHub
          </a>
          <a href="/docs/quick-start" className="btn-primary !px-4 !py-2.5 !text-sm">
            Get Started
            <ArrowRight size={15} strokeWidth={2.25} />
          </a>
        </div>

        <button
          type="button"
          className="nav-mobile-btn inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(37,99,255,0.12)] bg-white/70 text-[var(--navy)]"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="nav-mobile-panel nav-glass mx-auto mt-2 max-w-6xl rounded-2xl p-4"
          >
            <nav className="flex flex-col gap-1">
              {links.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  {...(link.external
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                  onClick={() => setOpen(false)}
                  className="rounded-xl px-3 py-3 text-sm font-medium text-[var(--navy)] hover:bg-white/70"
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <div className="mt-3 flex flex-col gap-2">
              <a
                href="https://github.com/DaosPath/handoffkit"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary w-full"
              >
                <GitHubIcon size={16} />
                Star on GitHub
              </a>
              <a
                href="/docs/quick-start"
                onClick={() => setOpen(false)}
                className="btn-primary w-full"
              >
                Get Started
                <ArrowRight size={15} />
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
