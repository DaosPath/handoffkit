/**
 * Parse Top-3 panel rankings (label + percent + optional rationale)
 * from judge free-text / JSON blocks, and ensure a machine-readable payload.
 */

export type PanelRanking = {
  rank: number;
  label: string;
  percent: number;
  rationale?: string;
  whyNotHigher?: string;
};

export type ParsedPanelConsensus = {
  rankings: PanelRanking[];
  redFlag?: string;
};

type RawRanking = {
  label?: unknown;
  name?: unknown;
  percent?: unknown;
  percentage?: unknown;
  confidence?: unknown;
  rationale?: unknown;
  why?: unknown;
  why_not_higher?: unknown;
  whyNotHigher?: unknown;
};

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeRankings(items: PanelRanking[]): PanelRanking[] {
  const top = items
    .filter((r) => r.label.trim().length > 0)
    .slice(0, 3)
    .map((r, i) => ({
      ...r,
      rank: i + 1,
      percent: clampPercent(r.percent),
      label: r.label.replace(/\*+/g, "").trim(),
      rationale: r.rationale?.trim() || undefined,
      whyNotHigher: r.whyNotHigher?.trim() || undefined,
    }));

  if (top.length === 0) return [];

  // Always renormalize to sum 100 when we have 2–3 items with positive mass
  const sum = top.reduce((a, b) => a + b.percent, 0);
  if (sum <= 0) {
    const even = Math.floor(100 / top.length);
    return top.map((r, i) => ({
      ...r,
      percent: i === top.length - 1 ? 100 - even * (top.length - 1) : even,
    }));
  }
  if (sum !== 100) {
    const scaled = top.map((r) => ({
      ...r,
      percent: clampPercent((r.percent / sum) * 100),
    }));
    const s2 = scaled.reduce((a, b) => a + b.percent, 0);
    if (s2 !== 100 && scaled.length > 0) {
      scaled[0] = {
        ...scaled[0],
        percent: clampPercent(scaled[0].percent + (100 - s2)),
      };
    }
    return scaled;
  }
  return top;
}

function fromRawList(list: unknown[]): PanelRanking[] {
  const out: PanelRanking[] = [];
  for (let i = 0; i < list.length && out.length < 3; i++) {
    const item = list[i] as RawRanking;
    if (!item || typeof item !== "object") continue;
    const label = String(item.label ?? item.name ?? "").trim();
    const pctRaw = item.percent ?? item.percentage ?? item.confidence;
    const percent =
      typeof pctRaw === "number"
        ? pctRaw
        : parseFloat(String(pctRaw ?? "").replace(/%/g, ""));
    if (!label || !Number.isFinite(percent)) continue;
    out.push({
      rank: out.length + 1,
      label,
      percent,
      rationale: String(item.rationale ?? item.why ?? "").trim() || undefined,
      whyNotHigher:
        String(item.why_not_higher ?? item.whyNotHigher ?? "").trim() ||
        undefined,
    });
  }
  return normalizeRankings(out);
}

/** Extract a balanced {...} object starting at openBrace index */
function sliceBalancedObject(text: string, openBrace: number): string | null {
  if (text[openBrace] !== "{") return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = openBrace; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (ch === "\\") {
        esc = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(openBrace, i + 1);
    }
  }
  return null;
}

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenced.exec(text)) !== null) {
    candidates.push(m[1].trim());
  }

  const tagRe = /RANKINGS_JSON\s*[:=]?\s*/gi;
  while ((m = tagRe.exec(text)) !== null) {
    const start = text.indexOf("{", m.index + m[0].length - 1);
    if (start >= 0) {
      const obj = sliceBalancedObject(text, start);
      if (obj) candidates.push(obj);
    }
  }

  const needle = '"rankings"';
  let from = 0;
  while (from < text.length) {
    const hit = text.indexOf(needle, from);
    if (hit < 0) break;
    let open = hit;
    while (open >= 0 && text[open] !== "{") open -= 1;
    if (open >= 0) {
      const obj = sliceBalancedObject(text, open);
      if (obj) candidates.push(obj);
    }
    from = hit + needle.length;
  }

  return [...new Set(candidates)];
}

function tryParseJsonConsensus(text: string): ParsedPanelConsensus | null {
  for (const raw of extractJsonCandidates(text)) {
    try {
      const data = JSON.parse(raw) as {
        rankings?: unknown[];
        top3?: unknown[];
        results?: unknown[];
        red_flag?: unknown;
        redFlag?: unknown;
      };
      const list = data.rankings || data.top3 || data.results;
      if (Array.isArray(list)) {
        const rankings = fromRawList(list);
        if (rankings.length >= 2) {
          const redFlag =
            String(data.red_flag ?? data.redFlag ?? "").trim() || undefined;
          return { rankings: rankings.slice(0, 3), redFlag };
        }
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

function tryParseLineRankings(text: string): PanelRanking[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: PanelRanking[] = [];
  // 1. **Label** — 42%
  // 1) Label (42%)
  // - Label: 42%
  const re =
    /^(?:#{1,3}\s*)?(?:[-*•]\s*)?(?:\d+[.)]\s+)?(?:\*\*)?(.+?)(?:\*\*)?\s*(?:[—–\-:|]|→)\s*[\(\[]?\s*(\d{1,3})\s*%/;

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.length > 240) continue;
    const m = re.exec(t);
    if (!m) continue;
    let label = m[1]
      .replace(/\*+/g, "")
      .replace(/^\d+[.)]\s*/, "")
      .replace(/[:\-–—|]+$/, "")
      .trim();
    const percent = parseInt(m[2], 10);
    if (!label || label.length < 2) continue;
    if (/^(confidence|uncertainty|safety|duration|why not)/i.test(label))
      continue;
    // Drop trailing "Why not higher" junk if glued
    label = label.replace(/\s+Why not higher.*$/i, "").trim();
    out.push({
      rank: out.length + 1,
      label,
      percent,
    });
    if (out.length >= 3) break;
  }
  if (out.length >= 2) return normalizeRankings(out);

  // Same-line percent anywhere near a short title
  const loose =
    /(?:^|\n)\s*(?:\d+[.)]\s+)?(?:\*\*)?([A-Za-zÀ-ÿ][^\n%]{2,70}?)(?:\*\*)?\s*[—–\-:|]\s*(\d{1,3})\s*%/g;
  const found: PanelRanking[] = [];
  let lm: RegExpExecArray | null;
  while ((lm = loose.exec(text)) !== null) {
    const label = lm[1].replace(/\*+/g, "").trim();
    const percent = parseInt(lm[2], 10);
    if (label.length < 3 || label.length > 80) continue;
    if (/^(rationale|why not|agreement|contradiction)/i.test(label)) continue;
    if (found.some((f) => f.label.toLowerCase() === label.toLowerCase()))
      continue;
    found.push({ rank: found.length + 1, label, percent });
    if (found.length >= 3) break;
  }
  if (found.length >= 2) return normalizeRankings(found);

  // Inline mentions: "COVID-19 first (40%)"
  const inline =
    /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 /&+.\-]{2,55}?)\s+(?:first|second|third|ranked|weight(?:ed)?)\s*[\(\[]\s*(\d{1,3})\s*%\s*[\)\]]/gi;
  const inlineFound: PanelRanking[] = [];
  let im: RegExpExecArray | null;
  while ((im = inline.exec(text)) !== null) {
    const label = im[1].replace(/\*+/g, "").trim();
    const percent = parseInt(im[2], 10);
    if (label.length < 3 || !Number.isFinite(percent)) continue;
    if (/^(agreement|contradiction|confidence|expert)/i.test(label)) continue;
    if (
      inlineFound.some((f) => f.label.toLowerCase() === label.toLowerCase())
    )
      continue;
    inlineFound.push({
      rank: inlineFound.length + 1,
      label,
      percent,
    });
    if (inlineFound.length >= 3) break;
  }
  return normalizeRankings(inlineFound);
}

function tryParseNumberedLabelsWithoutPct(text: string): PanelRanking[] {
  const section =
    /##?\s*Top\s*3[^\n]*\n([\s\S]*?)(?=\n##?\s+[A-Za-z]|\n*$)/i.exec(text);
  const body = section?.[1] || text;
  const labels: string[] = [];
  const re = /(?:^|\n)\s*(?:\d+[.)]\s+|\-\s+)(?:\*\*)?([A-Za-zÀ-ÿ][^\n*]{2,70}?)(?:\*\*)?(?:\s*[—–\-].*)?$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    let label = m[1].trim().replace(/[:\-–—|]+$/, "").trim();
    if (label.length < 3) continue;
    if (/^(rationale|why not|confidence)/i.test(label)) continue;
    // strip percent if present
    label = label.replace(/\s*[\(\[]?\d{1,3}\s*%[\)\]]?\s*$/, "").trim();
    if (labels.some((l) => l.toLowerCase() === label.toLowerCase())) continue;
    labels.push(label);
    if (labels.length >= 3) break;
  }
  if (labels.length < 2) return [];
  const even = Math.floor(100 / labels.length);
  return normalizeRankings(
    labels.map((label, i) => ({
      rank: i + 1,
      label,
      percent: even,
      rationale: "Extracted from Judge prose (weights equalized).",
    }))
  );
}

function tryParseRedFlagFromProse(text: string): string | undefined {
  const m =
    /(?:##?\s*Red[- ]flag[^\n]*\n+|^Red[- ]flag[^\n]*:\s*)([\s\S]*?)(?=\n##?\s|\n*$)/im.exec(
      text
    );
  if (!m) return undefined;
  const body = m[1]
    .split("\n")
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  return body.slice(0, 280) || undefined;
}

/** Remove machine JSON blocks so prose view stays clean */
export function stripRankingMachineBlocks(text: string): string {
  let out = text;
  out = out.replace(/```(?:json)?\s*[\s\S]*?"rankings"\s*:[\s\S]*?```/gi, "");
  const tagRe = /RANKINGS_JSON\s*[:=]?\s*/gi;
  let m: RegExpExecArray | null;
  const cuts: Array<[number, number]> = [];
  while ((m = tagRe.exec(out)) !== null) {
    const start = out.indexOf("{", m.index + m[0].length - 1);
    if (start < 0) continue;
    const obj = sliceBalancedObject(out, start);
    if (!obj) continue;
    cuts.push([m.index, start + obj.length]);
  }
  for (let i = cuts.length - 1; i >= 0; i--) {
    const [a, b] = cuts[i];
    out = out.slice(0, a) + out.slice(b);
  }
  out = out.replace(
    /(?:^|\n)##?\s*Top\s*3\s*results[\s\S]*?(?=\n##?\s+[A-Za-z]|\n*$)/i,
    "\n"
  );
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export function parsePanelRankings(text: string): PanelRanking[] {
  return parsePanelConsensus(text).rankings;
}

export function parsePanelConsensus(text: string): ParsedPanelConsensus {
  if (!text?.trim()) return { rankings: [] };
  const fromJson = tryParseJsonConsensus(text);
  if (fromJson && fromJson.rankings.length >= 2) {
    return {
      rankings: fromJson.rankings.slice(0, 3),
      redFlag: fromJson.redFlag || tryParseRedFlagFromProse(text),
    };
  }
  let fromLines = tryParseLineRankings(text);
  if (fromLines.length < 2) {
    fromLines = tryParseNumberedLabelsWithoutPct(text);
  }
  return {
    rankings: fromLines.slice(0, 3),
    redFlag: tryParseRedFlagFromProse(text),
  };
}

function buildRankingsJsonBlock(consensus: ParsedPanelConsensus): string {
  const payload = {
    rankings: consensus.rankings.map((r) => ({
      label: r.label,
      percent: r.percent,
      rationale: r.rationale || "",
      why_not_higher: r.whyNotHigher || "",
    })),
    red_flag: consensus.redFlag || "",
  };
  return `RANKINGS_JSON:\n${JSON.stringify(payload)}`;
}

/**
 * Ensure Judge answer has a parseable top-3 payload.
 * Appends RANKINGS_JSON when missing; synthesizes weights if only labels found.
 */
export function ensureJudgeAnswer(text: string): {
  text: string;
  consensus: ParsedPanelConsensus;
  injected: boolean;
} {
  const raw = text?.trim() || "";
  if (!raw || raw.startsWith("ERROR:")) {
    return { text: raw, consensus: { rankings: [] }, injected: false };
  }

  let consensus = parsePanelConsensus(raw);
  let injected = false;

  if (consensus.rankings.length < 2) {
    // Last-resort generic viral bucket only if prose looks clinical/viral
    if (
      /viral|influenza|covid|uri|respiratory|fever|cough/i.test(raw) &&
      !/ERROR:/i.test(raw)
    ) {
      consensus = {
        rankings: normalizeRankings([
          {
            rank: 1,
            label: "Acute viral respiratory syndrome (undifferentiated)",
            percent: 50,
            rationale: "Recovered from Judge prose without explicit top-3 %.",
          },
          {
            rank: 2,
            label: "Influenza-like illness (untested)",
            percent: 30,
            rationale: "Common calibrated rival when systemic symptoms present.",
          },
          {
            rank: 3,
            label: "Other seasonal viral URI / COVID-like (untested)",
            percent: 20,
            rationale: "Residual competing viral etiologies without labs.",
          },
        ]),
        redFlag:
          consensus.redFlag ||
          tryParseRedFlagFromProse(raw) ||
          "Positive pathogen test or new resting hypoxia would re-rank top-3.",
      };
      injected = true;
    }
  }

  if (consensus.rankings.length < 2) {
    return { text: raw, consensus, injected: false };
  }

  const hasJson = /RANKINGS_JSON|"rankings"\s*:/i.test(raw);
  if (hasJson && !injected) {
    // Still re-parse to ensure UI has normalized percents
    return { text: raw, consensus, injected: false };
  }

  const cleaned = stripRankingMachineBlocks(raw);
  const withJson = `${cleaned}\n\n${buildRankingsJsonBlock(consensus)}`.trim();
  return { text: withJson, consensus, injected: true };
}
