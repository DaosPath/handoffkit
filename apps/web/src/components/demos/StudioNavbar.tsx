"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, Plus, Settings, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { studioNav } from "@/lib/demo-data";

export function StudioNavbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="studio-header">
      <div className="mx-auto flex h-[3.75rem] max-w-[1400px] items-center gap-3 px-4 sm:px-6">
        <button
          type="button"
          className="docs-header-icon-btn docs-mobile-menu-btn"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>

        <Link href="/demos" className="shrink-0" aria-label="Handoff Kit Studio">
          <Logo height={28} priority studio />
        </Link>

        <nav className="mx-auto hidden items-center gap-0.5 md:flex">
          {studioNav.map((item) => {
            const active = item.label === "Demos";
            const external = "external" in item && item.external;
            return (
              <a
                key={item.label}
                href={item.href}
                {...(external
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                className={`studio-header-link ${
                  active ? "studio-header-link-active" : ""
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="docs-header-icon-btn"
            aria-label="Settings"
            title="Settings"
          >
            <Settings size={16} />
          </button>
          <button type="button" className="liquid-button !px-3.5 !py-2 !text-sm">
            <Plus size={15} strokeWidth={2.25} />
            New Run
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-[rgba(37,99,255,0.08)] px-4 py-3 md:hidden">
          <nav className="flex flex-col gap-1">
            {studioNav.map((item) => {
              const active = item.label === "Demos";
              const external = "external" in item && item.external;
              return (
                <a
                  key={item.label}
                  href={item.href}
                  {...(external
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                  onClick={() => setOpen(false)}
                  className={`rounded-xl px-3 py-2.5 text-sm font-medium ${
                    active
                      ? "bg-[rgba(37,99,255,0.1)] text-[var(--blue-deep)]"
                      : "text-[var(--navy-muted)]"
                  }`}
                >
                  {item.label}
                </a>
              );
            })}
          </nav>
        </div>
      )}
    </header>
  );
}
