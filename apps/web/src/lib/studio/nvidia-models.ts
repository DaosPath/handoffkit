/**
 * NVIDIA NIM free-endpoint catalog for Handoff Kit Studio.
 * Model IDs match build.nvidia.com / integrate.api.nvidia.com.
 * Prefer chat/instruct models with free trial endpoints.
 * Free tier availability can change; IDs are editable.
 */

export type NvidiaModelOption = {
  id: string;
  label: string;
  publisher: string;
  blurb: string;
  /** build.nvidia.com path when known */
  buildUrl?: string;
  tier: "free" | "flagship" | "fast";
};

/**
 * Curated free / trial-friendly chat models for multi-agent demos.
 * Highlighted: GLM-5.2 + Step 3.7 Flash (user-requested free endpoints).
 */
export const NVIDIA_FREE_MODELS: NvidiaModelOption[] = [
  {
    id: "z-ai/glm-5.2",
    label: "GLM-5.2",
    publisher: "z-ai",
    blurb: "Flagship agentic / coding / long-horizon reasoning",
    buildUrl: "https://build.nvidia.com/z-ai/glm-5.2",
    tier: "flagship",
  },
  {
    id: "stepfun-ai/step-3.7-flash",
    label: "Step 3.7 Flash",
    publisher: "stepfun-ai",
    blurb: "Fast sparse MoE — agentic & coding",
    buildUrl: "https://build.nvidia.com/stepfun-ai/step-3.7-flash",
    tier: "fast",
  },
  {
    id: "meta/llama-3.1-8b-instruct",
    label: "Llama 3.1 8B Instruct",
    publisher: "meta",
    blurb: "Fast, reliable free endpoint",
    buildUrl: "https://build.nvidia.com/meta/llama-3_1-8b-instruct",
    tier: "fast",
  },
  {
    id: "meta/llama-3.3-70b-instruct",
    label: "Llama 3.3 70B Instruct",
    publisher: "meta",
    blurb: "Strong general reasoning & tools",
    buildUrl: "https://build.nvidia.com/meta/llama-3_3-70b-instruct",
    tier: "flagship",
  },
  {
    id: "meta/llama-3.1-70b-instruct",
    label: "Llama 3.1 70B Instruct",
    publisher: "meta",
    blurb: "Proven 70B free instruct",
    buildUrl: "https://build.nvidia.com/meta/llama-3_1-70b-instruct",
    tier: "flagship",
  },
  {
    id: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    label: "Nemotron Super 49B v1.5",
    publisher: "nvidia",
    blurb: "Reasoning, tools, agentic chat",
    buildUrl:
      "https://build.nvidia.com/nvidia/llama-3_3-nemotron-super-49b-v1_5",
    tier: "flagship",
  },
  {
    id: "nvidia/llama-3.3-nemotron-super-49b-v1",
    label: "Nemotron Super 49B",
    publisher: "nvidia",
    blurb: "High efficiency agentic instruct",
    buildUrl:
      "https://build.nvidia.com/nvidia/llama-3_3-nemotron-super-49b-v1",
    tier: "flagship",
  },
  {
    id: "nvidia/nemotron-3-nano-30b-a3b",
    label: "Nemotron 3 Nano 30B",
    publisher: "nvidia",
    blurb: "Fast MoE · 1M context · tools",
    buildUrl: "https://build.nvidia.com/nvidia/nemotron-3-nano-30b-a3b",
    tier: "fast",
  },
  {
    id: "nvidia/llama-3.1-nemotron-70b-instruct",
    label: "Nemotron 70B Instruct",
    publisher: "nvidia",
    blurb: "NVIDIA-tuned Llama instruct",
    buildUrl:
      "https://build.nvidia.com/nvidia/llama-3_1-nemotron-70b-instruct",
    tier: "flagship",
  },
  {
    id: "google/gemma-2-9b-it",
    label: "Gemma 2 9B IT",
    publisher: "google",
    blurb: "Efficient instruction model",
    buildUrl: "https://build.nvidia.com/google/gemma-2-9b-it",
    tier: "fast",
  },
  {
    id: "google/gemma-2-27b-it",
    label: "Gemma 2 27B IT",
    publisher: "google",
    blurb: "Larger Gemma instruct",
    buildUrl: "https://build.nvidia.com/google/gemma-2-27b-it",
    tier: "free",
  },
  {
    id: "google/gemma-4-31b-it",
    label: "Gemma 4 31B IT",
    publisher: "google",
    blurb: "Frontier coding & agentic dense",
    buildUrl: "https://build.nvidia.com/google/gemma-4-31b-it",
    tier: "flagship",
  },
  {
    id: "mistralai/mistral-small-3.1-24b-instruct-2503",
    label: "Mistral Small 3.1 24B",
    publisher: "mistralai",
    blurb: "Balanced quality / speed",
    buildUrl:
      "https://build.nvidia.com/mistralai/mistral-small-3.1-24b-instruct-2503",
    tier: "free",
  },
  {
    id: "mistralai/mixtral-8x22b-instruct-v0.1",
    label: "Mixtral 8x22B Instruct",
    publisher: "mistralai",
    blurb: "MoE high quality",
    buildUrl: "https://build.nvidia.com/mistralai/mixtral-8x22b-instruct-v0.1",
    tier: "flagship",
  },
  {
    id: "mistralai/mistral-nemotron",
    label: "Mistral Nemotron",
    publisher: "mistralai",
    blurb: "Agentic coding & function calling",
    buildUrl: "https://build.nvidia.com/mistralai/mistral-nemotron",
    tier: "flagship",
  },
  {
    id: "deepseek-ai/deepseek-r1-distill-llama-8b",
    label: "DeepSeek R1 Distill 8B",
    publisher: "deepseek-ai",
    blurb: "Fast reasoning distill",
    buildUrl:
      "https://build.nvidia.com/deepseek-ai/deepseek-r1-distill-llama-8b",
    tier: "fast",
  },
  {
    id: "deepseek-ai/deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    publisher: "deepseek-ai",
    blurb: "Fast coding & agents · large MoE",
    buildUrl: "https://build.nvidia.com/deepseek-ai/deepseek-v4-flash",
    tier: "fast",
  },
  {
    id: "qwen/qwen2.5-7b-instruct",
    label: "Qwen2.5 7B Instruct",
    publisher: "qwen",
    blurb: "Fast multilingual instruct",
    buildUrl: "https://build.nvidia.com/qwen/qwen2.5-7b-instruct",
    tier: "fast",
  },
  {
    id: "qwen/qwen2.5-72b-instruct",
    label: "Qwen2.5 72B Instruct",
    publisher: "qwen",
    blurb: "High quality Qwen instruct",
    buildUrl: "https://build.nvidia.com/qwen/qwen2.5-72b-instruct",
    tier: "flagship",
  },
  {
    id: "microsoft/phi-4-mini-instruct",
    label: "Phi-4 Mini Instruct",
    publisher: "microsoft",
    blurb: "Compact high-signal model",
    buildUrl: "https://build.nvidia.com/microsoft/phi-4-mini-instruct",
    tier: "fast",
  },
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    publisher: "openai",
    blurb: "Open MoE reasoning LLM",
    buildUrl: "https://build.nvidia.com/openai/gpt-oss-120b",
    tier: "flagship",
  },
  {
    id: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B",
    publisher: "openai",
    blurb: "Smaller open MoE · efficient",
    buildUrl: "https://build.nvidia.com/openai/gpt-oss-20b",
    tier: "fast",
  },
  {
    id: "minimaxai/minimax-m2.7",
    label: "MiniMax M2.7",
    publisher: "minimaxai",
    blurb: "Coding, reasoning, office tasks",
    buildUrl: "https://build.nvidia.com/minimaxai/minimax-m2.7",
    tier: "flagship",
  },
];

export const DEFAULT_NVIDIA_MODEL = "z-ai/glm-5.2";

/** Sensible defaults: diverse free models per role */
export const DEFAULT_PANEL_MODELS = {
  "Expert A": "z-ai/glm-5.2",
  "Expert B": "stepfun-ai/step-3.7-flash",
  "Expert C": "meta/llama-3.1-8b-instruct",
  Judge: "z-ai/glm-5.2",
} as const;

export const PANEL_AGENT_ROLES = [
  "Expert A",
  "Expert B",
  "Expert C",
  "Judge",
] as const;

export type PanelAgentRole = (typeof PANEL_AGENT_ROLES)[number];

export const PANEL_ROLE_BLURB: Record<PanelAgentRole, string> = {
  "Expert A": "Primary analyst · top-3 framing",
  "Expert B": "Challenger · red-team",
  "Expert C": "Evidence · uncertainty",
  Judge: "Consensus · top 3 + %",
};

export function getModelLabel(id: string): string {
  return NVIDIA_FREE_MODELS.find((m) => m.id === id)?.label ?? id;
}

export function isKnownModel(id: string): boolean {
  return NVIDIA_FREE_MODELS.some((m) => m.id === id);
}
