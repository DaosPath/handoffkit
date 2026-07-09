/**
 * Minimal node tests for parse-rankings.
 * Run from apps/web: pnpm test:studio
 */

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const modPath = pathToFileURL(
  path.join(process.cwd(), "src/lib/studio/parse-rankings.ts")
).href;

const {
  parsePanelConsensus,
  ensureJudgeAnswer,
  stripRankingMachineBlocks,
} = await import(modPath);

function test(name, fn) {
  try {
    fn();
    console.log("ok ", name);
  } catch (e) {
    console.error("FAIL", name, e);
    process.exitCode = 1;
  }
}

test("parses RANKINGS_JSON", () => {
  const text = `
## Top 3 results
1. **ILI** — 44%
2. **COVID-like** — 25%
3. **Other viral URI** — 31%

RANKINGS_JSON:
{"rankings":[{"label":"ILI","percent":44,"rationale":"fit"},{"label":"COVID-like","percent":25},{"label":"Other viral URI","percent":31}],"red_flag":"hypoxia"}
`;
  const c = parsePanelConsensus(text);
  assert.equal(c.rankings.length, 3);
  assert.equal(c.rankings[0].label, "ILI");
  assert.equal(c.rankings[0].percent, 44);
  assert.match(c.redFlag || "", /hypoxia/i);
});

test("parses prose percents without JSON", () => {
  const text = `
## Top 3 results
1. **Influenza-like illness** — 42%
   Fits winter fever.
2. **COVID-like illness** — 28%
   Compatible dry cough.
3. **Other seasonal viral URI** — 30%
   Non-specific URI.
`;
  const c = parsePanelConsensus(text);
  assert.ok(c.rankings.length >= 2, "expected rankings");
  assert.ok(c.rankings[0].percent > 0);
  assert.equal(
    c.rankings.reduce((a, b) => a + b.percent, 0),
    100
  );
});

test("ensureJudgeAnswer injects RANKINGS_JSON", () => {
  const text = `
## Consensus summary
Viral syndrome after travel.

## Top 3 results
1. Influenza-like illness — 45%
2. COVID-like — 30%
3. Other viral URI — 25%
`;
  const { text: out, consensus, injected } = ensureJudgeAnswer(text);
  assert.equal(consensus.rankings.length, 3);
  assert.ok(injected);
  assert.match(out, /RANKINGS_JSON/);
  assert.equal(
    consensus.rankings.reduce((a, b) => a + b.percent, 0),
    100
  );
});

test("strip removes machine block", () => {
  const text = `Hello\n\nRANKINGS_JSON:\n{"rankings":[{"label":"A","percent":50},{"label":"B","percent":50}]}\n`;
  const s = stripRankingMachineBlocks(text);
  assert.ok(!s.includes("RANKINGS_JSON"));
  assert.match(s, /Hello/);
});

test("ensure recovers viral prose without percents", () => {
  const text = `
## Consensus summary
Acute viral respiratory syndrome after travel with fever and dry cough.
## Expert agreement
Experts agree on viral etiology; influenza and COVID remain open.
`;
  const { consensus } = ensureJudgeAnswer(text);
  assert.ok(consensus.rankings.length >= 2);
});

console.log(process.exitCode ? "FAILED" : "all passed");
