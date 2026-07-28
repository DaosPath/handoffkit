import {
  Agent,
  EchoProvider as CoreEchoProvider,
  FallbackProvider as CoreFallbackProvider,
  HANDOFFKIT_CORE_VERSION,
  HandoffState,
  OpenAIProvider,
  Team,
} from "@handoffkit/core";
import {
  CspRuntime,
  HANDOFFKIT_CSP_VERSION,
  MessageEnvelope,
  RuntimeMode,
  makeEnvelope,
} from "@handoffkit/csp";
import {
  EchoProvider,
  FallbackProvider,
  HANDOFFKIT_PROVIDERS_VERSION,
  OpenAICompatibleProvider,
  ProviderRouter,
  RetryPolicy,
  sanitizeErrorBody,
} from "@handoffkit/providers";
import { FileTraceStore, JsonMemoryStore, ProjectIndexer } from "@handoffkit/node";
import { HANDOFFKIT_BROWSER_VERSION, registerBrowserTools, webSearch } from "@handoffkit/browser";
import { Recipe, RecipeRunner, realFusionPanel } from "@handoffkit/recipes";
import { TemplateScaffolder } from "@handoffkit/templates";
import { VERSION, main } from "@handoffkit/cli";

const agent = new Agent({ name: "Planner" });
const cspRuntime = new CspRuntime({ mode: RuntimeMode.SESSION });
const team = new Team({ agents: [agent], runtimeMode: RuntimeMode.SESSION, runtime: cspRuntime });
const envelope: MessageEnvelope<{ task: string }> = makeEnvelope({
  sessionId: "typed",
  channel: "tasks",
  source: "type-smoke",
  payloadType: "task",
  payload: { task: "typed" },
  sequence: 1,
});
const handoff = new HandoffState({ task: "test", fromAgent: "A", toAgent: "B", summary: "done", nextSteps: ["ship"] });
const coreFallback = new CoreFallbackProvider({ providers: [new CoreEchoProvider()] });
const retry = new RetryPolicy({ maxAttempts: 2 });
const provider = new OpenAICompatibleProvider({ provider: "ollama", model: "test", retryPolicy: retry });
const router = new ProviderRouter({ providers: [new EchoProvider(), new FallbackProvider({ providers: [provider] })] });
const openai = new OpenAIProvider({ apiKey: "type-only", fetchImpl: async () => new Response("{}") });
const traceStore = new FileTraceStore();
const memoryStore = new JsonMemoryStore("memory.json");
const indexer = new ProjectIndexer({ maxFiles: 100 });
const recipe = new Recipe({ name: "typed", steps: [] });
const runner = new RecipeRunner(recipe);
const scaffolder = new TemplateScaffolder();

void [HANDOFFKIT_CORE_VERSION, HANDOFFKIT_CSP_VERSION, HANDOFFKIT_PROVIDERS_VERSION, HANDOFFKIT_BROWSER_VERSION, VERSION, envelope, handoff, coreFallback, openai, traceStore, memoryStore, indexer, runner, scaffolder];
void registerBrowserTools;
void webSearch;
void team.arun("typed");
void router.route("typed");
void realFusionPanel("ollama", ["test"], "typed", { signal: new AbortController().signal });
void main(["--version"]);
void sanitizeErrorBody("error", 100);
