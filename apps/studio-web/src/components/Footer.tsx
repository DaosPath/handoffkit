"use client";

import { FormEvent, useState } from "react";
import { Logo } from "./Logo";

const product = [
  { label: "Features", href: "#features" },
  { label: "Use Cases", href: "#use-cases" },
  { label: "Pricing", href: "#pricing" },
];

const resources = [
  { label: "Docs", href: "/docs" },
  { label: "Templates", href: "/docs/examples" },
  { label: "Blog", href: "#" },
];

const community = [
  {
    label: "GitHub",
    href: "https://github.com/DaosPath/handoffkit",
    external: true,
  },
  { label: "Discord", href: "#", external: false },
  { label: "Twitter/X", href: "#", external: false },
];

export function Footer() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "ok">("idle");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("ok");
    setEmail("");
  };

  return (
    <footer className="relative border-t border-[rgba(37,99,255,0.08)] px-4 pb-10 pt-16 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <a href="#" className="inline-block" aria-label="Handoff Kit home">
              <Logo height={28} />
            </a>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-[var(--navy-muted)]">
              Structured handoffs for reliable multi-agent AI systems.
              Open source. Developer first.
            </p>

            <form onSubmit={onSubmit} className="mt-6 flex max-w-sm gap-2">
              <label htmlFor="newsletter-email" className="sr-only">
                Email
              </label>
              <input
                id="newsletter-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="newsletter-input"
                autoComplete="email"
              />
              <button type="submit" className="btn-primary !px-4 !py-2.5 !text-sm shrink-0">
                Subscribe
              </button>
            </form>
            {status === "ok" && (
              <p className="mt-2 text-xs text-[var(--blue)]">
                Thanks — we&apos;ll keep you posted.
              </p>
            )}
          </div>

          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--navy)]">
              Product
            </p>
            <ul className="flex flex-col gap-2">
              {product.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    className="text-sm text-[var(--navy-muted)] transition hover:text-[var(--blue)]"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--navy)]">
              Resources
            </p>
            <ul className="flex flex-col gap-2">
              {resources.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    className="text-sm text-[var(--navy-muted)] transition hover:text-[var(--blue)]"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--navy)]">
              Community
            </p>
            <ul className="flex flex-col gap-2">
              {community.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    {...(l.external
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                    className="text-sm text-[var(--navy-muted)] transition hover:text-[var(--blue)]"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div
          id="pricing"
          className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-[rgba(37,99,255,0.08)] pt-8 sm:flex-row sm:items-center"
        >
          <p className="text-xs text-[var(--navy-muted)]">
            © 2026 Handoff Kit. MIT License.
          </p>
          <div className="flex flex-wrap gap-4 text-xs text-[var(--navy-muted)]">
            <a href="#" className="hover:text-[var(--blue)]">
              Privacy
            </a>
            <a href="#" className="hover:text-[var(--blue)]">
              Terms
            </a>
            <a href="#" className="hover:text-[var(--blue)]">
              Security
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
