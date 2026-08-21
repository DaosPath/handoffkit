import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  const envelope = JSON.parse(line);
  envelope.source = "node-child";
  envelope.target = "parent";
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}
