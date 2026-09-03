/**
 * Local deterministic tool execution demo in JavaScript.
 */
import { Agent, defineTool } from "../src/index.js";

function main() {
  const readTool = defineTool({
    name: "read_file",
    description: "Read a file from disk.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    execute: ({ path }) => `Content of ${path}: HandoffKit JS tool execution success!`,
  });

  const writeTool = defineTool({
    name: "write_file",
    description: "Write a file to disk.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
    execute: ({ path, content }) => `Wrote to ${path}: ${content}`,
  });

  const agent = new Agent({
    name: "FileAgent",
    role: "Use tools to inspect and modify files.",
  });

  const report = agent.runWithTools("read file sample.txt", {
    tools: [readTool, writeTool],
    toolCalls: [{ name: "read_file", arguments: { path: "sample.txt" }, callId: "c_js_1" }],
  });

  console.log("Success:", report.success);
  console.log("Tool Results:", report.toolResults.map(r => `${r.name}: ${r.output}`));
  console.log("Final Agent Output:", report.agentResult.finalOutput);
}

main();
