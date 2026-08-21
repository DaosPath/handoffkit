"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Check,
  Copy,
  Scale,
  Sparkles,
  AlertTriangle,
  Trophy,
  Medal,
  ShieldAlert,
  Flag,
} from "lucide-react";
import {
  ensureJudgeAnswer,
  stripRankingMachineBlocks,
  type PanelRanking,
} from "@/lib/studio/parse-rankings";

type Props = {
  answer: string;
  model?: string;
  durationMs?: number;
  success?: boolean;
  safetyNote?: string;
  runId?: string;
};

/** Lightweight markdown-ish formatting for judge consensus output */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index));
    }
    const token = m[0];
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={`b-${key++}`} className="mai-fa-strong">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={`c-${key++}`} className="mai-fa-code">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("*")) {
      nodes.push(
        <em key={`i-${key++}`} className="mai-fa-em">
          {token.slice(1, -1)}
        </em>
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Block =
  | { type: "h"; level: 1 | 2 | 3; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "hr" };

function parseBlocks(raw: string): Block[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const flushPara = (buf: string[]) => {
    const t = buf.join(" ").trim();
    if (t) blocks.push({ type: "p", text: t });
    buf.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    const h = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (h) {
      blocks.push({
        type: "h",
        level: h[1].length as 1 | 2 | 3,
        text: h[2].trim(),
      });
      i += 1;
      continue;
    }

    const numHead = /^(\d+)\.\s+([A-Z][^.!?]{2,60})$/.exec(trimmed);
    if (numHead && !trimmed.includes("  ")) {
      blocks.push({ type: "h", level: 2, text: trimmed });
      i += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "quote", text: quoteLines.join(" ") });
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ""));
        i += 1;
      }
      if (
        items.length === 1 &&
        items[0].length < 70 &&
        !items[0].includes(".")
      ) {
        blocks.push({ type: "h", level: 2, text: `${trimmed}` });
      } else {
        blocks.push({ type: "ol", items });
      }
      continue;
    }

    const boldOnly = /^\*\*([^*]+)\*\*:?\s*$/.exec(trimmed);
    if (boldOnly) {
      blocks.push({ type: "h", level: 2, text: boldOnly[1].trim() });
      i += 1;
      continue;
    }

    const labeled = /^([A-Za-z][A-Za-z0-9 /&-]{1,40}):\s+(.+)$/.exec(trimmed);
    if (labeled && labeled[2].length > 0) {
      blocks.push({
        type: "p",
        text: `**${labeled[1]}:** ${labeled[2]}`,
      });
      i += 1;
      continue;
    }

    const para: string[] = [trimmed];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3})\s+/.test(lines[i].trim()) &&
      !/^[-*•]\s+/.test(lines[i].trim()) &&
      !/^\d+[.)]\s+/.test(lines[i].trim()) &&
      !/^>\s?/.test(lines[i].trim()) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    flushPara(para);
  }

  return blocks;
}

function BlocksView({ blocks }: { blocks: Block[] }) {
  return (
    <div className="mai-fa-prose">
      {blocks.map((b, idx) => {
        if (b.type === "h") {
          const Tag = b.level === 1 ? "h2" : b.level === 2 ? "h3" : "h4";
          return (
            <Tag key={idx} className={`mai-fa-h mai-fa-h${b.level}`}>
              {renderInline(b.text)}
            </Tag>
          );
        }
        if (b.type === "ul") {
          return (
            <ul key={idx} className="mai-fa-ul">
              {b.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        if (b.type === "ol") {
          return (
            <ol key={idx} className="mai-fa-ol">
              {b.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ol>
          );
        }
        if (b.type === "quote") {
          return (
            <blockquote key={idx} className="mai-fa-quote">
              {renderInline(b.text)}
            </blockquote>
          );
        }
        if (b.type === "hr") {
          return <hr key={idx} className="mai-fa-hr" />;
        }
        return (
          <p key={idx} className="mai-fa-p">
            {renderInline(b.text)}
          </p>
        );
      })}
    </div>
  );
}

function RankIcon({ rank }: { rank: number }) {
  if (rank === 1) return <Trophy size={16} strokeWidth={2.2} />;
  if (rank === 2) return <Medal size={16} strokeWidth={2.2} />;
  return <Sparkles size={16} strokeWidth={2.2} />;
}

function RankingsShowcase({
  rankings,
  redFlag,
}: {
  rankings: PanelRanking[];
  redFlag?: string;
}) {
  const max = Math.max(...rankings.map((r) => r.percent), 1);
  const total = rankings.reduce((a, b) => a + b.percent, 0);
  const accent = ["#d97706", "#2563eb", "#7c3aed"] as const;
  const soft = [
    "linear-gradient(165deg,#fffbeb 0%,#ffffff 70%)",
    "linear-gradient(165deg,#eff6ff 0%,#ffffff 70%)",
    "linear-gradient(165deg,#f5f3ff 0%,#ffffff 70%)",
  ] as const;

  return (
    <div
      className="mai-rank"
      style={{
        position: "relative",
        zIndex: 1,
        marginTop: "1.2rem",
        padding: "1.15rem 1.05rem 1.2rem",
        borderRadius: 20,
        background:
          "linear-gradient(165deg, rgba(255,255,255,0.98), rgba(239,246,255,0.85))",
        border: "1px solid rgba(37,99,255,0.14)",
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.95) inset, 0 16px 36px -22px rgba(37,99,255,0.22)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "0.55rem",
          marginBottom: "0.95rem",
          padding: "0.65rem 0.75rem",
          borderRadius: 12,
          background: "rgba(245, 158, 11, 0.08)",
          border: "1px solid rgba(245, 158, 11, 0.22)",
        }}
      >
        <ShieldAlert
          size={16}
          strokeWidth={2.2}
          style={{ color: "#d97706", flexShrink: 0, marginTop: 1 }}
        />
        <p
          style={{
            margin: 0,
            fontSize: "0.74rem",
            lineHeight: 1.45,
            color: "#92400e",
          }}
        >
          <strong style={{ fontWeight: 750 }}>Research-only weights.</strong>{" "}
          Not a diagnosis, not medical advice, and not for patient care. Percents
          are panel uncertainty allocations, not test results.
        </p>
      </div>

      <div
        className="mai-rank-head"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: "0.75rem 1rem",
          marginBottom: "1rem",
        }}
      >
        <div>
          <p
            className="mai-rank-kicker"
            style={{
              margin: 0,
              fontSize: "0.62rem",
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#2563eb",
            }}
          >
            Panel consensus
          </p>
          <h3
            className="mai-rank-title"
            style={{
              margin: "0.2rem 0 0",
              fontSize: "1.2rem",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              color: "#07142f",
              lineHeight: 1.2,
            }}
          >
            Top 3 possibilities
          </h3>
          <p
            className="mai-rank-sub"
            style={{
              margin: "0.3rem 0 0",
              fontSize: "0.78rem",
              color: "#64748b",
              lineHeight: 1.4,
            }}
          >
            Calibrated research-level weights from the Judge
          </p>
        </div>
        <div
          className="mai-rank-sum"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 2,
            lineHeight: 1.15,
          }}
        >
          <span
            className="mai-rank-sum-n"
            style={{
              fontSize: "1.4rem",
              fontWeight: 800,
              color: "#1d4ed8",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {total}%
          </span>
          <span
            className="mai-rank-sum-l"
            style={{
              fontSize: "0.62rem",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#94a3b8",
            }}
          >
            allocated
          </span>
        </div>
      </div>

      <div
        className="mai-rank-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: "0.8rem",
          alignItems: "stretch",
        }}
      >
        {rankings.map((r, idx) => {
          const color = accent[Math.min(idx, 2)];
          return (
            <article
              key={`${r.rank}-${r.label}`}
              className={`mai-rank-card mai-rank-card-${r.rank}${
                r.rank === 1 ? " is-lead" : ""
              }`}
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                minWidth: 0,
                padding: "1rem 1rem 0.95rem 1.1rem",
                borderRadius: 16,
                background: soft[Math.min(idx, 2)],
                border: `1px solid ${color}33`,
                boxShadow:
                  r.rank === 1
                    ? "0 18px 34px -18px rgba(245,158,11,0.32)"
                    : "0 10px 24px -18px rgba(15,23,42,0.18)",
                overflow: "hidden",
              }}
            >
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 4,
                  background: color,
                }}
              />
              <div
                className="mai-rank-card-top"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.65rem",
                }}
              >
                <span
                  className="mai-rank-badge"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "0.3rem 0.6rem",
                    borderRadius: 999,
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    color,
                    background: `${color}14`,
                    border: `1px solid ${color}33`,
                    whiteSpace: "nowrap",
                  }}
                >
                  <RankIcon rank={r.rank} />
                  <span>{`# ${r.rank}`}</span>
                </span>
                <span
                  className="mai-rank-pct"
                  style={{
                    display: "inline-flex",
                    alignItems: "baseline",
                    gap: 2,
                    lineHeight: 1,
                    flexShrink: 0,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <span
                    className="mai-rank-pct-n"
                    style={{
                      fontSize: "2rem",
                      fontWeight: 800,
                      letterSpacing: "-0.04em",
                      color,
                    }}
                  >
                    {r.percent}
                  </span>
                  <span
                    className="mai-rank-pct-s"
                    style={{
                      fontSize: "0.9rem",
                      fontWeight: 700,
                      color: "#94a3b8",
                    }}
                  >
                    %
                  </span>
                </span>
              </div>
              <h4
                className="mai-rank-label"
                style={{
                  margin: "0.1rem 0 0",
                  fontSize: "1rem",
                  fontWeight: 750,
                  letterSpacing: "-0.02em",
                  lineHeight: 1.3,
                  color: "#0f172a",
                }}
              >
                {r.label}
              </h4>
              {r.rationale && (
                <p
                  className="mai-rank-why"
                  style={{
                    margin: 0,
                    flex: 1,
                    fontSize: "0.8rem",
                    lineHeight: 1.55,
                    color: "#64748b",
                  }}
                >
                  {r.rationale}
                </p>
              )}
              {r.whyNotHigher && (
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.72rem",
                    lineHeight: 1.45,
                    color: "#64748b",
                    padding: "0.4rem 0.5rem",
                    borderRadius: 10,
                    background: "rgba(15,23,42,0.03)",
                    border: "1px solid rgba(226,232,240,0.95)",
                  }}
                >
                  <span style={{ fontWeight: 700, color: "#475569" }}>
                    Why not higher:{" "}
                  </span>
                  {r.whyNotHigher}
                </p>
              )}
              <div
                className="mai-rank-bar"
                role="meter"
                aria-valuenow={r.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${r.label} ${r.percent} percent`}
                style={{
                  marginTop: "0.35rem",
                  height: 8,
                  borderRadius: 99,
                  background: "#f1f5f9",
                  overflow: "hidden",
                }}
              >
                <div
                  className="mai-rank-bar-fill"
                  style={{
                    width: `${Math.max(8, (r.percent / max) * 100)}%`,
                    height: "100%",
                    borderRadius: 99,
                    background: `linear-gradient(90deg, ${color}99, ${color})`,
                    transition: "width 0.75s cubic-bezier(0.22,1,0.36,1)",
                    minWidth: 8,
                  }}
                />
              </div>
            </article>
          );
        })}
      </div>

      {redFlag && (
        <div
          style={{
            marginTop: "0.95rem",
            display: "flex",
            alignItems: "flex-start",
            gap: "0.55rem",
            padding: "0.75rem 0.85rem",
            borderRadius: 14,
            background: "rgba(124, 58, 237, 0.06)",
            border: "1px solid rgba(124, 58, 237, 0.16)",
          }}
        >
          <Flag
            size={15}
            strokeWidth={2.2}
            style={{ color: "#7c3aed", flexShrink: 0, marginTop: 2 }}
          />
          <div>
            <p
              style={{
                margin: 0,
                fontSize: "0.62rem",
                fontWeight: 750,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#7c3aed",
              }}
            >
              Red-flag re-rank trigger
            </p>
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.8rem",
                lineHeight: 1.5,
                color: "#475569",
              }}
            >
              {redFlag}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function FinalAnswerCard({
  answer,
  model,
  durationMs,
  success = true,
  safetyNote,
  runId,
}: Props) {
  const [copied, setCopied] = useState(false);
  // Only hard-error on explicit ERROR payloads; long synthesis counts as complete
  // even if upstream success flag was overly strict.
  const isError =
    answer.trim().startsWith("ERROR:") ||
    (!success && answer.trim().length < 80);

  const ensured = useMemo(() => ensureJudgeAnswer(answer), [answer]);
  const rankings = ensured.consensus.rankings;
  const consensus = ensured.consensus;

  const prose = useMemo(
    () => stripRankingMachineBlocks(ensured.text.trim() || "—"),
    [ensured.text]
  );

  const blocks = useMemo(() => parseBlocks(prose), [prose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <section
      id="final-answer"
      className={`mai-fa${isError ? " is-error" : ""}`}
      aria-labelledby="mai-fa-title"
    >
      <div className="mai-fa-glow" aria-hidden />

      <header className="mai-fa-header">
        <div className="mai-fa-header-left">
          <div className={`mai-fa-icon${isError ? " is-error" : ""}`}>
            {isError ? (
              <AlertTriangle size={18} strokeWidth={2.2} />
            ) : (
              <Scale size={18} strokeWidth={2.2} />
            )}
          </div>
          <div>
            <div className="mai-fa-kicker">
              <Sparkles size={12} strokeWidth={2.4} />
              {isError
                ? "Run incomplete"
                : rankings.length >= 2
                  ? "Consensus result"
                  : "Judge synthesis"}
            </div>
            <h2 id="mai-fa-title" className="mai-fa-title">
              Final answer
            </h2>
            <p className="mai-fa-sub">
              {rankings.length >= 2
                ? "Top-3 panel weights + full Judge synthesis"
                : "Full Judge synthesis (structured top-3 not detected)"}
            </p>
          </div>
        </div>

        <div className="mai-fa-meta">
          {model && (
            <span className="mai-fa-pill" title={model}>
              {model.split("/").pop() || model}
            </span>
          )}
          {typeof durationMs === "number" && (
            <span className="mai-fa-pill mai-fa-pill-muted">
              {(durationMs / 1000).toFixed(1)}s
            </span>
          )}
          {runId && (
            <span className="mai-fa-pill mai-fa-pill-muted" title={runId}>
              {runId}
            </span>
          )}
          <button
            type="button"
            className="mai-fa-copy"
            onClick={() => void copy()}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </header>

      {rankings.length >= 2 && (
        <RankingsShowcase rankings={rankings} redFlag={consensus.redFlag} />
      )}

      <div className="mai-fa-body">
        <div className="mai-fa-rail" aria-hidden />
        <div className="mai-fa-detail">
          <p className="mai-fa-detail-label">Full synthesis</p>
          <BlocksView blocks={blocks} />
        </div>
      </div>

      {safetyNote && (
        <footer className="mai-fa-footer">
          <span className="mai-fa-footer-label">Safety</span>
          <p>{safetyNote}</p>
        </footer>
      )}
    </section>
  );
}
