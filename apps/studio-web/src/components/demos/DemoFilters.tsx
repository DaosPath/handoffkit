"use client";

import { ChevronDown, Search } from "lucide-react";
import {
  demoCategories,
  type DemoCategory,
} from "@/lib/demo-data";

type DemoFiltersProps = {
  active: DemoCategory;
  onChange: (c: DemoCategory) => void;
  query: string;
  onQueryChange: (q: string) => void;
  sort: string;
  onSortChange: (s: string) => void;
};

export function DemoFilters({
  active,
  onChange,
  query,
  onQueryChange,
  sort,
  onSortChange,
}: DemoFiltersProps) {
  return (
    <section className="px-4 sm:px-6">
      <div className="liquid-shell mx-auto flex max-w-[1400px] flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-3.5">
        <div className="filters-scroll relative z-10 min-w-0 flex-1">
          {demoCategories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => onChange(cat)}
              className={`liquid-pill ${active === cat ? "liquid-pill-active" : ""}`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="relative z-10 flex shrink-0 items-center gap-2">
          <label className="relative inline-flex">
            <span className="sr-only">Sort</span>
            <select
              value={sort}
              onChange={(e) => onSortChange(e.target.value)}
              className="liquid-pill appearance-none !pr-8 cursor-pointer"
            >
              <option value="popular">Popular</option>
              <option value="newest">Newest</option>
              <option value="name">Name</option>
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--navy-muted)]"
            />
          </label>

          <div className="demo-search w-full min-w-[160px] sm:w-[200px]">
            <Search size={14} className="shrink-0 text-[var(--blue)]" />
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search demos..."
              aria-label="Search demos"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
