/**
 * Customer Support Escalation example in JavaScript.
 * Shows a multi-agent team (Triage -> Billing -> Refund -> Supervisor) running with HandoffKit.
 */
import { Agent, Team, HandoffProtocol } from "../src/index.js";

async function main() {
  console.log("Setting up Support Escalation Team...");

  const triage = new Agent({
    name: "Triage",
    role: "Classify incoming customer issues and route them to billing or technical support.",
  });

  const billing = new Agent({
    name: "Billing",
    role: "Inspect charge logs and subscription states to identify double billing or proration errors.",
  });

  const refund = new Agent({
    name: "Refund",
    role: "Prepare refunds and account credits in stripe according to the refund policy.",
  });

  const supervisor = new Agent({
    name: "Supervisor",
    role: "Approve refund requests that exceed the automated threshold and reply to the customer.",
  });

  const team = new Team({
    agents: [triage, billing, refund, supervisor],
    protocol: new HandoffProtocol({ mode: "natural" }),
  });

  const task = "Resolve ticket #1837: customer reports double billing for renewal.";
  const result = await team.arun(task);

  console.log("\n--- Team Run Success:", result.success);
  console.log("--- Final Output:\n", result.finalOutput);

  console.log("\n--- Structured Handoffs Trail:");
  result.handoffs.forEach((h, idx) => {
    console.log(`\nHandoff #${idx + 1}: ${h.fromAgent} -> ${h.toAgent}`);
    console.log(h.toMarkdown());
  });
}

main();
