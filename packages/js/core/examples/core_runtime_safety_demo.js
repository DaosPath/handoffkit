/**
 * 1.14.2 mini-demo: offline fallback + structured handoff (JavaScript).
 * Mirrors Python examples/demos/core_runtime_safety_demo.py and C++ consumer_core.
 * No network required.
 */
import {
  Agent,
  EchoProvider,
  FailingProvider,
  FallbackProvider,
  HandoffProtocol,
  Team,
} from "../src/index.js";

function main() {
  console.log("handoffkit JS — core_runtime_safety_demo (1.14.2)");
  console.log("theme: FallbackProvider + Team hybrid_state handoff\n");

  const fb = new FallbackProvider({
    providers: [
      new FailingProvider({ model: "primary-fail", message: "primary down (demo)" }),
      new EchoProvider({ model: "secondary-echo" }),
    ],
    model: "fallback-chain",
  });
  const answer = fb.generate("Ship a minimal offline multi-agent handoff.");
  if (!String(answer).includes("secondary-echo") && !String(answer).includes("Echo")) {
    throw new Error("fallback did not return echo secondary");
  }
  console.log("[fallback] selectedModel=", fb.selectedModel);
  console.log(String(answer).slice(0, 200), "...\n");

  const team = new Team({
    agents: [
      new Agent({
        name: "Architect",
        role: "Plan offline-safe multi-runtime handoffs.",
        provider: new EchoProvider({ model: "arch" }),
      }),
      new Agent({
        name: "Coder",
        role: "Implement installable core surfaces.",
        provider: new EchoProvider({ model: "coder" }),
      }),
    ],
    protocol: new HandoffProtocol({ mode: "hybrid_state" }),
  });

  const result = team.run("Document handoffkit::core install for C++ and parity demos for Python/JS.");
  console.log("[team] success=", result.success, "handoffs=", (result.handoffs || []).length);
  console.log("[team] final_output_chars=", String(result.finalOutput || "").length);
  console.log("\ncore_runtime_safety_demo OK");
}

main();
