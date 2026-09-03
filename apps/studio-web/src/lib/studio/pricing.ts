/**
 * Transparent commercial pricing references for Studio cost estimates.
 *
 * Primary source for on-demand $/M token rates:
 *   https://groq.com/pricing  (Groq On-Demand, public linear pricing)
 *
 * OpenCode Zen also publishes pay-as-you-go $/M rates and a models catalog:
 *   https://opencode.ai/docs/zen/#pricing
 *   https://opencode.ai/zen/v1/models  (often auth-gated; not used live here)
 *
 * NVIDIA NIM free trial endpoints used in Studio demos bill as $0 for the trial
 * (subject to NVIDIA API Trial Terms). Commercial NIM pricing is not public
 * the same way — we surface Groq as the consultable commercial comparison.
 */

export type TokenRates = {
  /** USD per 1M input tokens */
  inputPerM: number;
  /** USD per 1M output tokens */
  outputPerM: number;
};

export type PricedModel = {
  id: string;
  label: string;
  provider: "groq" | "nvidia-nim-free" | "opencode-zen";
  rates: TokenRates | "free";
  sourceUrl: string;
  note?: string;
};

/** Snapshot of Groq public rates (consult https://groq.com/pricing). */
export const GROQ_PRICING: Record<string, PricedModel> = {
  "llama-3.1-8b-instant": {
    id: "llama-3.1-8b-instant",
    label: "Llama 3.1 8B Instant",
    provider: "groq",
    rates: { inputPerM: 0.05, outputPerM: 0.08 },
    sourceUrl: "https://groq.com/pricing",
  },
  "llama-3.3-70b-versatile": {
    id: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B Versatile",
    provider: "groq",
    rates: { inputPerM: 0.59, outputPerM: 0.79 },
    sourceUrl: "https://groq.com/pricing",
  },
  "llama-4-scout": {
    id: "meta-llama/llama-4-scout-17b-16e-instruct",
    label: "Llama 4 Scout",
    provider: "groq",
    rates: { inputPerM: 0.11, outputPerM: 0.34 },
    sourceUrl: "https://groq.com/pricing",
  },
  "gpt-oss-20b": {
    id: "openai/gpt-oss-20b",
    label: "GPT OSS 20B",
    provider: "groq",
    rates: { inputPerM: 0.075, outputPerM: 0.3 },
    sourceUrl: "https://groq.com/pricing",
  },
};

export const NVIDIA_FREE_MARKER: PricedModel = {
  id: "nvidia-nim-free-trial",
  label: "NVIDIA NIM free trial",
  provider: "nvidia-nim-free",
  rates: "free",
  sourceUrl: "https://build.nvidia.com/models",
  note: "Studio live demos use free trial endpoints when available.",
};

export type UsageLine = {
  role: string;
  modelId: string;
  modelLabel: string;
  inputTokens: number;
  outputTokens: number;
  /** which rate table was used */
  pricingKey: keyof typeof GROQ_PRICING | "nvidia-free";
};

export type CostBreakdown = {
  lines: Array<
    UsageLine & {
      costUsd: number;
      rateNote: string;
    }
  >;
  totalTokens: number;
  totalInput: number;
  totalOutput: number;
  totalUsd: number;
  currency: "USD";
  pricingSource: string;
  pricingSourceUrl: string;
  asOfLabel: string;
};

export function costForTokens(
  rates: TokenRates,
  inputTokens: number,
  outputTokens: number
): number {
  return (
    (inputTokens / 1_000_000) * rates.inputPerM +
    (outputTokens / 1_000_000) * rates.outputPerM
  );
}

export function formatUsd(n: number, digits = 4): string {
  if (n === 0) return "$0.00";
  if (n < 0.0001) return `$${n.toFixed(6)}`;
  if (n < 0.01) return `$${n.toFixed(digits)}`;
  return `$${n.toFixed(Math.min(4, digits))}`;
}

export function formatTokens(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function estimateGroqCost(lines: UsageLine[]): CostBreakdown {
  const priced = lines.map((line) => {
    if (line.pricingKey === "nvidia-free") {
      return {
        ...line,
        costUsd: 0,
        rateNote: "NVIDIA free trial · $0",
      };
    }
    const model = GROQ_PRICING[line.pricingKey];
    const rates = model?.rates;
    if (!rates || rates === "free") {
      return {
        ...line,
        costUsd: 0,
        rateNote: "free / unknown",
      };
    }
    const costUsd = costForTokens(rates, line.inputTokens, line.outputTokens);
    return {
      ...line,
      costUsd,
      rateNote: `$${rates.inputPerM}/M in · $${rates.outputPerM}/M out`,
    };
  });

  const totalInput = priced.reduce((a, b) => a + b.inputTokens, 0);
  const totalOutput = priced.reduce((a, b) => a + b.outputTokens, 0);
  const totalUsd = priced.reduce((a, b) => a + b.costUsd, 0);

  return {
    lines: priced,
    totalTokens: totalInput + totalOutput,
    totalInput,
    totalOutput,
    totalUsd,
    currency: "USD",
    pricingSource: "Groq On-Demand public pricing",
    pricingSourceUrl: "https://groq.com/pricing",
    asOfLabel: "rates from groq.com/pricing",
  };
}

/**
 * Token usage captured from a real Studio MAI panel topology
 * (3 experts parallel + judge), sized from a live benchmark-style run.
 * Output sizes approximated from measured character lengths (~4 chars/token).
 */
export const MAI_FEATURED_USAGE: UsageLine[] = [
  {
    role: "Expert A",
    modelId: "z-ai/glm-5.2",
    modelLabel: "GLM-5.2 (NIM free)",
    inputTokens: 2_850,
    outputTokens: 420,
    pricingKey: "nvidia-free",
  },
  {
    role: "Expert B",
    modelId: "stepfun-ai/step-3.7-flash",
    modelLabel: "Step 3.7 Flash (NIM free)",
    inputTokens: 2_850,
    outputTokens: 480,
    pricingKey: "nvidia-free",
  },
  {
    role: "Expert C",
    modelId: "meta/llama-3.1-8b-instruct",
    modelLabel: "Llama 3.1 8B (NIM free)",
    inputTokens: 2_850,
    outputTokens: 400,
    pricingKey: "nvidia-free",
  },
  {
    role: "Judge",
    modelId: "z-ai/glm-5.2",
    modelLabel: "GLM-5.2 (NIM free)",
    inputTokens: 5_200,
    outputTokens: 920,
    pricingKey: "nvidia-free",
  },
];

/**
 * Same token volumes priced as if run commercially on Groq
 * (consultable rates). Maps flagship roles → 70B, flash → 8B.
 */
export const MAI_FEATURED_GROQ_EQUIV: UsageLine[] = [
  {
    role: "Expert A",
    modelId: "llama-3.3-70b-versatile",
    modelLabel: "Llama 3.3 70B (Groq)",
    inputTokens: 2_850,
    outputTokens: 420,
    pricingKey: "llama-3.3-70b-versatile",
  },
  {
    role: "Expert B",
    modelId: "llama-3.1-8b-instant",
    modelLabel: "Llama 3.1 8B Instant (Groq)",
    inputTokens: 2_850,
    outputTokens: 480,
    pricingKey: "llama-3.1-8b-instant",
  },
  {
    role: "Expert C",
    modelId: "llama-3.1-8b-instant",
    modelLabel: "Llama 3.1 8B Instant (Groq)",
    inputTokens: 2_850,
    outputTokens: 400,
    pricingKey: "llama-3.1-8b-instant",
  },
  {
    role: "Judge",
    modelId: "llama-3.3-70b-versatile",
    modelLabel: "Llama 3.3 70B (Groq)",
    inputTokens: 5_200,
    outputTokens: 920,
    pricingKey: "llama-3.3-70b-versatile",
  },
];

export function getMaiFeaturedCosts() {
  const nimFree = estimateGroqCost(MAI_FEATURED_USAGE);
  // force free totals for NIM path
  const freeBreakdown: CostBreakdown = {
    ...nimFree,
    lines: nimFree.lines.map((l) => ({
      ...l,
      costUsd: 0,
      rateNote: "NVIDIA NIM free trial",
    })),
    totalUsd: 0,
    pricingSource: "NVIDIA NIM free trial endpoints",
    pricingSourceUrl: "https://build.nvidia.com/models",
    asOfLabel: "Studio live · free trial",
  };
  const groq = estimateGroqCost(MAI_FEATURED_GROQ_EQUIV);
  return { freeBreakdown, groq };
}
