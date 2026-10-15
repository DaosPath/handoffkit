"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  CornerDownLeft,
  FileText,
  Hash,
  Search,
  X,
} from "lucide-react";
import {
  getSearchShortcutLabel,
  searchDocs,
  type SearchResult,
} from "@/lib/docs-search";

type DocsSearchProps = {
  /** Controlled open state from parent (optional) */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Compact trigger only (mobile icon) */
  iconOnly?: boolean;
};

export function DocsSearch({
  open: controlledOpen,
  onOpenChange,
  iconOnly = false,
}: DocsSearchProps) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [shortcut, setShortcut] = useState("⌘K");

  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback(
    (value: boolean) => {
      onOpenChange?.(value);
      if (controlledOpen === undefined) setInternalOpen(value);
      if (!value) {
        setQuery("");
        setActiveIndex(0);
      }
    },
    [controlledOpen, onOpenChange]
  );

  const results = useMemo(() => searchDocs(query, 8), [query]);
  const emptyQuery = query.trim().length === 0;

  useEffect(() => {
    setShortcut(getSearchShortcutLabel());
  }, []);

  // Global ⌘K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router, setOpen]
  );

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && results[activeIndex]) {
      e.preventDefault();
      go(results[activeIndex].href);
    }
  };

  return (
    <>
      {/* Trigger — long polished bar */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          iconOnly
            ? "docs-search-icon-btn"
            : "docs-search-trigger"
        }
        aria-label="Search documentation"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Search size={iconOnly ? 16 : 15} className="shrink-0 text-[var(--blue)]" />
        {!iconOnly && (
          <>
            <span className="docs-search-trigger-label">
              Search documentation…
            </span>
            <kbd className="docs-search-kbd">{shortcut}</kbd>
          </>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="docs-search-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setOpen(false)}
            role="presentation"
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Search documentation"
              className="docs-search-modal"
              initial={{ opacity: 0, y: -16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Liquid ambient */}
              <div className="liquid-blob liquid-blob-blue absolute -right-10 -top-12 h-36 w-36 opacity-40" />
              <div
                className="liquid-blob liquid-blob-soft absolute -bottom-16 -left-8 h-40 w-40 opacity-35"
                style={{ animationDelay: "-3s" }}
              />

              <div className="relative z-10">
                <div className="docs-search-input-row">
                  <Search size={18} className="shrink-0 text-[var(--blue)]" />
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Search docs, guides, API, CLI…"
                    className="docs-search-input"
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-activedescendant={
                      results[activeIndex]
                        ? `${listId}-opt-${activeIndex}`
                        : undefined
                    }
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {query && (
                    <button
                      type="button"
                      className="docs-search-clear"
                      onClick={() => {
                        setQuery("");
                        inputRef.current?.focus();
                      }}
                      aria-label="Clear search"
                    >
                      <X size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="docs-search-esc"
                    onClick={() => setOpen(false)}
                  >
                    Esc
                  </button>
                </div>

                <div className="docs-search-divider" />

                <div id={listId} className="docs-search-results" role="listbox">
                  <p className="docs-search-group-label">
                    {emptyQuery ? "Suggested" : results.length ? "Results" : "No results"}
                  </p>

                  {results.length === 0 ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="docs-search-empty"
                    >
                      <FileText size={22} className="text-[var(--blue)]/50" />
                      <p>No matches for “{query}”</p>
                      <p className="text-xs text-[var(--navy-muted)]">
                        Try “handoff”, “team”, “cli”, or “trace”.
                      </p>
                    </motion.div>
                  ) : (
                    <ul className="docs-search-list">
                      {results.map((item, index) => (
                        <SearchResultRow
                          key={item.id}
                          id={`${listId}-opt-${index}`}
                          item={item}
                          active={index === activeIndex}
                          emptyQuery={emptyQuery}
                          onHover={() => setActiveIndex(index)}
                          onSelect={() => go(item.href)}
                        />
                      ))}
                    </ul>
                  )}
                </div>

                <div className="docs-search-footer">
                  <span className="docs-search-hint">
                    <kbd>↑</kbd>
                    <kbd>↓</kbd>
                    navigate
                  </span>
                  <span className="docs-search-hint">
                    <kbd>
                      <CornerDownLeft size={10} />
                    </kbd>
                    open
                  </span>
                  <span className="docs-search-hint ml-auto">
                    <BookOpen size={12} />
                    Handoff Kit Docs
                  </span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function SearchResultRow({
  id,
  item,
  active,
  emptyQuery,
  onHover,
  onSelect,
}: {
  id: string;
  item: SearchResult;
  active: boolean;
  emptyQuery: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  return (
    <li role="option" id={id} aria-selected={active}>
      <button
        type="button"
        className={`docs-search-item ${active ? "docs-search-item-active" : ""}`}
        onMouseEnter={onHover}
        onClick={onSelect}
      >
        <span className="docs-search-item-icon">
          {emptyQuery ? <Hash size={14} /> : <FileText size={14} />}
        </span>
        <span className="docs-search-item-body">
          <span className="docs-search-item-title">{item.title}</span>
          <span className="docs-search-item-desc">{item.description}</span>
        </span>
        <span className="docs-search-item-meta">
          <span className="docs-search-item-section">{item.section}</span>
          <ArrowRight
            size={14}
            className={`docs-search-item-arrow ${active ? "opacity-100" : "opacity-0"}`}
          />
        </span>
      </button>
    </li>
  );
}
