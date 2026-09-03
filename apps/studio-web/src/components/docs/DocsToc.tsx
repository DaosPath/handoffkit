"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { GitHubIcon } from "@/components/icons";
import { GITHUB_URL } from "@/lib/docs-nav";

export type TocItem = {
  id: string;
  title: string;
};

type DocsTocProps = {
  items: TocItem[];
};

const sdks = [
  { name: "Python", status: "Primary", badge: "sdk-badge-primary" },
  { name: "TypeScript", status: "Ready", badge: "sdk-badge-ready" },
  { name: "Rust", status: "Future", badge: "sdk-badge-future" },
  { name: "C++", status: "Future", badge: "sdk-badge-future" },
];

const SCROLL_OFFSET = 120;

type ProgressState = {
  activeId: string;
  fillHeight: number;
  railHeight: number;
};

function computeProgress(
  ids: string[],
  navEl: HTMLElement | null
): ProgressState {
  const fallback: ProgressState = {
    activeId: ids[0] ?? "",
    fillHeight: 0,
    railHeight: 0,
  };

  if (ids.length === 0 || !navEl) return fallback;

  const links = Array.from(
    navEl.querySelectorAll<HTMLElement>("[data-toc-link]")
  );
  if (links.length === 0) return fallback;

  const sections = ids
    .map((id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      return {
        id,
        top: el.getBoundingClientRect().top + window.scrollY,
      };
    })
    .filter(Boolean) as { id: string; top: number }[];

  if (sections.length === 0) return fallback;

  const scrollY = window.scrollY + SCROLL_OFFSET;
  let activeIndex = 0;
  for (let i = 0; i < sections.length; i++) {
    if (scrollY >= sections[i].top - 8) activeIndex = i;
  }

  const currentTop = sections[activeIndex].top;
  const nextTop =
    activeIndex < sections.length - 1
      ? sections[activeIndex + 1].top
      : currentTop + Math.max(400, window.innerHeight * 0.55);
  const local = Math.min(
    1,
    Math.max(0, (scrollY - currentTop) / Math.max(1, nextTop - currentTop))
  );

  const first = links[0];
  const last = links[links.length - 1];
  const railTop = first.offsetTop;
  const railBottom = last.offsetTop + last.offsetHeight;
  const railHeight = Math.max(0, railBottom - railTop);

  const cur = links[Math.min(activeIndex, links.length - 1)];
  const next =
    activeIndex < links.length - 1 ? links[activeIndex + 1] : cur;
  const curMid = cur.offsetTop + cur.offsetHeight / 2;
  const nextMid = next.offsetTop + next.offsetHeight / 2;
  const thumbY = curMid + (nextMid - curMid) * local;

  const nearBottom =
    window.scrollY + window.innerHeight >=
    document.documentElement.scrollHeight - 48;

  const fillHeight = nearBottom
    ? railHeight
    : Math.min(railHeight, Math.max(0, thumbY - railTop));

  return {
    activeId: sections[activeIndex].id,
    fillHeight,
    railHeight,
  };
}

export function DocsToc({ items }: DocsTocProps) {
  const navRef = useRef<HTMLElement>(null);
  const [state, setState] = useState<ProgressState>({
    activeId: items[0]?.id ?? "",
    fillHeight: 0,
    railHeight: 0,
  });

  useEffect(() => {
    if (items.length === 0) return;
    const ids = items.map((i) => i.id);

    const update = () => {
      setState(computeProgress(ids, navRef.current));
    };

    const raf = requestAnimationFrame(update);
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        update();
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("hashchange", update);
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("hashchange", update);
      window.removeEventListener("resize", onScroll);
    };
  }, [items]);

  const onClick = (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    setState((s) => ({ ...s, activeId: id }));
    const y =
      el.getBoundingClientRect().top + window.scrollY - (SCROLL_OFFSET - 16);
    window.history.replaceState(null, "", `#${id}`);
    window.scrollTo({ top: y, behavior: "smooth" });
  };

  return (
    <aside className="relative z-10 space-y-4">
      <div className="liquid-panel p-4">
        <p className="relative z-10 mb-3 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-[var(--navy-muted)]">
          On this page
        </p>

        <nav
          ref={navRef}
          className="toc-nav relative z-10"
          aria-label="On this page"
        >
          {/* Clean progressive rail — no dots / thumb */}
          <div className="toc-rail" aria-hidden>
            <div
              className="toc-rail-fill"
              style={{ height: `${Math.max(0, state.fillHeight)}px` }}
            />
          </div>

          {items.map((item) => {
            const active = state.activeId === item.id;
            return (
              <a
                key={item.id}
                data-toc-link
                href={`#${item.id}`}
                onClick={onClick(item.id)}
                className={`toc-link ${active ? "toc-link-active" : ""}`}
                aria-current={active ? "location" : undefined}
              >
                {item.title}
              </a>
            );
          })}
        </nav>
      </div>

      <div className="liquid-card p-4 !rounded-2xl">
        <div className="relative z-10">
          <p className="text-sm font-semibold text-[var(--navy)]">
            New to Handoff Kit?
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--navy-muted)]">
            Follow the quick start guide and build your first agent in minutes.
          </p>
          <Link
            href="/docs/quick-start"
            className="liquid-button mt-3 !px-3.5 !py-2 !text-xs"
          >
            Start Building
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>

      <div className="liquid-panel p-4">
        <p className="relative z-10 mb-3 text-sm font-semibold text-[var(--navy)]">
          SDKs &amp; Runtimes
        </p>
        <ul className="relative z-10 space-y-2">
          {sdks.map((sdk) => (
            <li
              key={sdk.name}
              className="flex items-center justify-between text-sm"
            >
              <span className="font-medium text-[var(--navy)]">{sdk.name}</span>
              <span className={`sdk-badge ${sdk.badge}`}>{sdk.status}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="liquid-card p-4 !rounded-2xl">
        <div className="relative z-10">
          <p className="text-sm font-semibold text-[var(--navy)]">Need help?</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--navy-muted)]">
            Join our community or open an issue on GitHub.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="#" className="liquid-button-secondary !px-3 !py-1.5 !text-xs">
              Discord
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="liquid-button-secondary !px-3 !py-1.5 !text-xs"
            >
              <GitHubIcon size={12} />
              GitHub
            </a>
          </div>
        </div>
      </div>
    </aside>
  );
}
