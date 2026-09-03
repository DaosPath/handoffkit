/**
 * Modularizer for @handoffkit/core — dependency-safe cut points.
 */
import fs from "node:fs";

if (!process.argv.includes("--force-regenerate")) {
  throw new Error(
    "split.mjs is an archival migration tool and can overwrite hardened modules. Pass --force-regenerate only after reviewing index.monolith.js.",
  );
}

const monolithPath = fs.existsSync("index.monolith.js")
  ? "index.monolith.js"
  : "index.js";
const src = fs.readFileSync(monolithPath, "utf8");
fs.writeFileSync("index.monolith.js", src);
const lines = src.split(/(?<=\n)/);

function findLine(pat, from = 0) {
  for (let i = from; i < lines.length; i++) if (pat.test(lines[i])) return i;
  return -1;
}

const iValidationErr = findLine(/^export class HandoffValidationError\b/);
const iBaseProvider = findLine(/^export class BaseProvider\b/);
const iAgent = findLine(/^export class Agent\b/);
const iProtocol = findLine(/^export class HandoffProtocol\b/);
const iQuality = findLine(/^export class HandoffQualityEvaluator\b/);
const iTraceEvent = findLine(/^export class TraceEvent\b/);
const iTool = findLine(/^export class Tool\b/);
const iListSection = findLine(/^function listSection\b/);
const iDefineTool = findLine(/^export function defineTool\b/);
const iContextDoc = findLine(/^export class ContextDocument\b/);
const iVersion = findLine(/^export const HANDOFFKIT_CORE_VERSION\b/);
const iEval = findLine(/^export class EvaluationCheck\b/);
const iUnsafe = findLine(/^export class UnsafeToolCallError\b/);
const iMemEntry = findLine(/^export class MemoryEntry\b/);
const iExt = findLine(/^export class Extension\b/);

// Pure helpers only (no ToolCall dependency)
const pureHelpersEnd = findLine(/^function normalizeToolSchema\b/);
const pureHelpers = lines.slice(iListSection, pureHelpersEnd).join("");

// Tool parsers stay with tools module
const toolParsers = lines.slice(pureHelpersEnd, iContextDoc).join("");

const topConstants = lines
  .slice(0, iValidationErr)
  .join("")
  .replace(/^const /gm, "export const ");

const publicUtils = lines.slice(iVersion, iEval).join("");

const utilsBody =
  "/** Shared pure helpers + public JSON utilities */\n" +
  topConstants +
  "\n" +
  pureHelpers
    .replace(/^function /gm, "export function ")
    .replace(/^async function /gm, "export async function ") +
  "\n" +
  publicUtils;

fs.writeFileSync("utils.js", utilsBody);

// tools body = Tool..defineTool + parsers (normalizeToolSchema through ContextDocument)
const toolsBody =
  lines.slice(iTool, iListSection).join("") + // Tool classes until helpers
  toolParsers; // normalizeToolSchema, parse*, sleep — ToolCall is in same file above

const orderBodies = {
  "utils.js": utilsBody,
  "contracts.js": lines.slice(iValidationErr, iBaseProvider).join(""),
  "providers-core.js": lines.slice(iBaseProvider, iAgent).join(""),
  "safety.js": lines.slice(iUnsafe, iMemEntry).join(""),
  "tools.js": toolsBody,
  "agent.js": lines.slice(iAgent, iProtocol).join(""),
  "team.js": lines.slice(iProtocol, iQuality).join(""),
  "quality.js": lines.slice(iQuality, iTraceEvent).join(""),
  "tracing.js": lines.slice(iTraceEvent, iTool).join(""),
  "context.js": lines.slice(iContextDoc, iVersion).join(""),
  "evaluation.js": lines.slice(iEval, iUnsafe).join(""),
  "memory.js": lines.slice(iMemEntry, iExt).join(""),
  "extensions.js": lines.slice(iExt).join(""),
};

const order = Object.keys(orderBodies);
const orderIdx = Object.fromEntries(order.map((f, i) => [f, i]));

const exportsOf = {};
for (const [file, body] of Object.entries(orderBodies)) {
  const names = new Set();
  for (const m of body.matchAll(/export (?:class|function|const) (\w+)/g)) names.add(m[1]);
  exportsOf[file] = names;
}

const symbolFile = {};
for (const [file, names] of Object.entries(exportsOf)) {
  for (const n of names) symbolFile[n] = file;
}

for (const file of order) {
  if (file === "utils.js") {
    fs.writeFileSync(file, orderBodies[file]);
    continue;
  }
  const body = orderBodies[file];
  const need = new Map();
  const own = exportsOf[file] || new Set();
  for (const [sym, from] of Object.entries(symbolFile)) {
    if (from === file || own.has(sym)) continue;
    if (orderIdx[from] >= orderIdx[file]) continue;
    if (new RegExp(`\\b${sym}\\b`).test(body)) {
      if (!need.has(from)) need.set(from, new Set());
      need.get(from).add(sym);
    }
  }
  let header = "";
  for (const [from, names] of need) {
    header += `import { ${[...names].sort().join(", ")} } from "./${from}";\n`;
  }
  if (header) header += "\n";
  fs.writeFileSync(file, header + body);
  console.log(file, "<-", [...need.keys()].join(", ") || "(none)");
}

fs.writeFileSync(
  "index.js",
  `/**
 * @handoffkit/core public API (modular layout).
 */
export * from "./utils.js";
export * from "./contracts.js";
export * from "./providers-core.js";
export * from "./safety.js";
export * from "./tools.js";
export * from "./agent.js";
export * from "./team.js";
export * from "./quality.js";
export * from "./tracing.js";
export * from "./context.js";
export * from "./evaluation.js";
export * from "./memory.js";
export * from "./extensions.js";
`
);
console.log("index facade ok");
