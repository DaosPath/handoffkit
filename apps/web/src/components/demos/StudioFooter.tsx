import Link from "next/link";
import { Logo } from "@/components/Logo";
import { GITHUB_URL } from "@/lib/docs-nav";

export function StudioFooter() {
  return (
    <footer className="border-t border-[rgba(37,99,255,0.08)] px-4 py-8 sm:px-6">
      <div className="mx-auto flex max-w-[1400px] flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-2">
          <Logo height={24} studio />
          <p className="text-sm text-[var(--navy-muted)]">Built with Handoff Kit</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Link href="/" className="text-[var(--navy-muted)] hover:text-[var(--blue)]">
            Landing
          </Link>
          <Link href="/docs" className="text-[var(--navy-muted)] hover:text-[var(--blue)]">
            Docs
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[var(--blue)] hover:underline"
          >
            Open source on GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
