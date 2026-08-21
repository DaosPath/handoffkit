"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Gauge,
  Sparkles,
  Zap,
} from "lucide-react";
import type {
  NvidiaModelOption,
  PanelAgentRole,
} from "@/lib/studio/nvidia-models";
import { PANEL_ROLE_BLURB } from "@/lib/studio/nvidia-models";

const ROLE_META: Record<
  PanelAgentRole,
  { short: string; accent: string; icon: "spark" | "zap" | "gauge" | "judge" }
> = {
  "Expert A": { short: "A", accent: "blue", icon: "spark" },
  "Expert B": { short: "B", accent: "violet", icon: "zap" },
  "Expert C": { short: "C", accent: "teal", icon: "gauge" },
  Judge: { short: "J", accent: "amber", icon: "judge" },
};

function TierIcon({ tier }: { tier?: string }) {
  if (tier === "fast") return <Zap size={11} strokeWidth={2.4} />;
  if (tier === "flagship") return <Sparkles size={11} strokeWidth={2.4} />;
  return <Gauge size={11} strokeWidth={2.4} />;
}

function publisherInitials(publisher: string) {
  const p = publisher.trim();
  if (!p) return "?";
  if (p.includes("-")) {
    return p
      .split("-")
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("");
  }
  return p.slice(0, 2).toUpperCase();
}

type Props = {
  role: PanelAgentRole;
  value: string;
  models: NvidiaModelOption[];
  disabled?: boolean;
  onChange: (modelId: string) => void;
};

export function AgentModelPicker({
  role,
  value,
  models,
  disabled,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const meta = ROLE_META[role];
  const selected = useMemo(
    () => models.find((m) => m.id === value) ?? null,
    [models, value]
  );

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>(
      '[data-active="true"]'
    );
    active?.scrollIntoView({ block: "nearest" });
  }, [open, value]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div
      ref={rootRef}
      className={`mai-mpick mai-mpick-${meta.accent}${open ? " is-open" : ""}${
        disabled ? " is-disabled" : ""
      }`}
    >
      <div className="mai-mpick-top">
        <div className="mai-mpick-role-row">
          <span className="mai-mpick-avatar" aria-hidden>
            {meta.short}
          </span>
          <div className="mai-mpick-role-text">
            <span className="mai-mpick-role">{role}</span>
            <span className="mai-mpick-blurb">{PANEL_ROLE_BLURB[role]}</span>
          </div>
        </div>
        {selected?.tier && (
          <span className={`mai-mpick-tier mai-mpick-tier-${selected.tier}`}>
            <TierIcon tier={selected.tier} />
            {selected.tier}
          </span>
        )}
      </div>

      <button
        type="button"
        className="mai-mpick-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`Model for ${role}`}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
      >
        <span className="mai-mpick-mono" aria-hidden>
          {publisherInitials(selected?.publisher ?? value.split("/")[0] ?? "?")}
        </span>
        <span className="mai-mpick-trigger-body">
          <span className="mai-mpick-label">
            {selected?.label ?? value.split("/").pop() ?? value}
          </span>
          <span className="mai-mpick-sub">
            {selected?.publisher ?? value.split("/")[0] ?? "NVIDIA NIM"}
            {selected?.blurb ? ` · ${selected.blurb}` : ""}
          </span>
        </span>
        <ChevronDown
          size={16}
          strokeWidth={2.2}
          className={`mai-mpick-chevron${open ? " is-open" : ""}`}
        />
      </button>

      <div className="mai-mpick-foot">
        <code className="mai-mpick-id" title={value}>
          {value}
        </code>
        {selected?.buildUrl && (
          <a
            href={selected.buildUrl}
            target="_blank"
            rel="noreferrer"
            className="mai-mpick-docs"
            onClick={(e) => e.stopPropagation()}
          >
            NIM
            <ExternalLink size={11} strokeWidth={2.2} />
          </a>
        )}
      </div>

      {open && (
        <div
          id={listId}
          ref={listRef}
          className="mai-mpick-menu"
          role="listbox"
          aria-label={`Choose model for ${role}`}
        >
          <div className="mai-mpick-menu-head">
            <span>Free NVIDIA endpoints</span>
            <span className="mai-mpick-menu-count">{models.length}</span>
          </div>
          <ul className="mai-mpick-list">
            {models.map((m) => {
              const active = m.id === value;
              return (
                <li key={m.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-active={active ? "true" : "false"}
                    className={`mai-mpick-option${active ? " is-active" : ""}`}
                    onClick={() => pick(m.id)}
                  >
                    <span className="mai-mpick-option-mono" aria-hidden>
                      {publisherInitials(m.publisher)}
                    </span>
                    <span className="mai-mpick-option-body">
                      <span className="mai-mpick-option-row">
                        <span className="mai-mpick-option-label">{m.label}</span>
                        <span
                          className={`mai-mpick-tier mai-mpick-tier-sm mai-mpick-tier-${m.tier}`}
                        >
                          <TierIcon tier={m.tier} />
                          {m.tier}
                        </span>
                      </span>
                      <span className="mai-mpick-option-sub">
                        <span className="mai-mpick-pub">{m.publisher}</span>
                        <span className="mai-mpick-dot">·</span>
                        <span className="mai-mpick-option-blurb">{m.blurb}</span>
                      </span>
                      <span className="mai-mpick-option-id">{m.id}</span>
                    </span>
                    {active && (
                      <Check
                        size={15}
                        strokeWidth={2.6}
                        className="mai-mpick-check"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
