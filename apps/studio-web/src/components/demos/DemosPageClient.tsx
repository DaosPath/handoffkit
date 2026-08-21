"use client";

import { useMemo, useState } from "react";
import { MotionProvider } from "@/components/MotionProvider";
import { demos, type DemoCategory } from "@/lib/demo-data";
import { StudioNavbar } from "./StudioNavbar";
import { DemosHero } from "./DemosHero";
import { DemoFilters } from "./DemoFilters";
import { DemoCard } from "./DemoCard";
import { FeaturedDemo } from "./FeaturedDemo";
import { StudioFooter } from "./StudioFooter";

export function DemosPageClient() {
  const [category, setCategory] = useState<DemoCategory>("All Demos");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("popular");
  const [selectedId, setSelectedId] = useState("mai-style-panel");

  const filtered = useMemo(() => {
    let list = demos.filter((d) => {
      const catOk =
        category === "All Demos" ? true : d.category === category;
      const q = query.trim().toLowerCase();
      const qOk =
        !q ||
        d.title.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.tags.some((t) => t.label.toLowerCase().includes(q));
      return catOk && qOk;
    });

    if (sort === "name") {
      list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    } else if (sort === "newest") {
      list = [...list].reverse();
    } else {
      // popular: featured first
      list = [...list].sort(
        (a, b) => Number(!!b.featured) - Number(!!a.featured)
      );
    }
    return list;
  }, [category, query, sort]);

  return (
    <MotionProvider>
      <div className="relative min-h-screen">
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="liquid-blob liquid-blob-blue absolute -left-28 top-40 h-80 w-80 opacity-25" />
          <div
            className="liquid-blob liquid-blob-soft absolute -right-20 bottom-40 h-96 w-96 opacity-30"
            style={{ animationDelay: "-6s" }}
          />
        </div>

        <StudioNavbar />
        <DemosHero />
        <DemoFilters
          active={category}
          onChange={setCategory}
          query={query}
          onQueryChange={setQuery}
          sort={sort}
          onSortChange={setSort}
        />

        <section className="px-4 py-10 sm:px-6 sm:py-12">
          <div className="mx-auto grid max-w-[1400px] gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {filtered.map((demo, i) => (
              <DemoCard
                key={demo.id}
                demo={demo}
                index={i}
                selected={selectedId === demo.id}
                onSelect={(id) => {
                  setSelectedId(id);
                  document
                    .getElementById("replay")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="mx-auto mt-8 max-w-[1400px] text-center text-sm text-[var(--navy-muted)]">
              No demos match your filters. Try another category or search term.
            </p>
          )}
        </section>

        <FeaturedDemo demoId={selectedId} />
        <StudioFooter />
      </div>
    </MotionProvider>
  );
}
