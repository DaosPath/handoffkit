/**
 * Basic EchoProvider agent example in JavaScript.
 */
import { Agent } from "../src/index.js";

function main() {
  const agent = new Agent({
    name: "Planner",
    role: "Create concise implementation plans with decisions and next steps.",
  });

  const result = agent.run("Create a plan for a JS app with tests.");
  console.log("Agent Name:", result.agentName);
  console.log("Task:", result.task);
  console.log("Final Output:\n", result.finalOutput);
}

main();
