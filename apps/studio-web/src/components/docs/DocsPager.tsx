import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { getAdjacentDocs } from "@/lib/docs-nav";

export function DocsPager({ pathname }: { pathname: string }) {
  const { prev, next } = getAdjacentDocs(pathname);

  if (!prev && !next) return null;

  return (
    <div className="mt-12 grid gap-3 border-t border-[rgba(37,99,255,0.1)] pt-8 sm:grid-cols-2">
      {prev ? (
        <Link
          href={prev.href}
          className="liquid-card group flex flex-col gap-1 p-4 !rounded-2xl no-underline"
        >
          <span className="relative z-10 flex items-center gap-1 text-xs text-[var(--navy-muted)]">
            <ArrowLeft size={12} /> Previous
          </span>
          <span className="relative z-10 font-semibold text-[var(--navy)] group-hover:text-[var(--blue)]">
            {prev.title}
          </span>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link
          href={next.href}
          className="liquid-card group flex flex-col items-end gap-1 p-4 !rounded-2xl text-right no-underline"
        >
          <span className="relative z-10 flex items-center gap-1 text-xs text-[var(--navy-muted)]">
            Next <ArrowRight size={12} />
          </span>
          <span className="relative z-10 font-semibold text-[var(--navy)] group-hover:text-[var(--blue)]">
            {next.title}
          </span>
        </Link>
      ) : null}
    </div>
  );
}
