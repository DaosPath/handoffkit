import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const generator = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../contracts/test-fixtures/tls/generate.py",
);

export function generateTlsFixtures() {
  const output = mkdtempSync(join(tmpdir(), "handoffkit-node-tls-"));
  const candidates = [
    process.env.HANDOFFKIT_PYTHON_BIN,
    process.platform === "win32" ? "python" : "python3",
    "python",
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  let failure = null;
  for (const executable of candidates) {
    const result = spawnSync(
      executable,
      [generator, "--output", output],
      { encoding: "utf8", timeout: 30_000 },
    );
    if (result.error?.code === "ENOENT") {
      failure = result.error;
      continue;
    }
    if (result.status !== 0) {
      rmSync(output, { recursive: true, force: true });
      throw new Error(
        `TLS fixture generation failed with ${executable}: ${result.stderr || result.stdout}`,
      );
    }
    let cleaned = false;
    return {
      root: output,
      cleanup() {
        if (cleaned) return;
        cleaned = true;
        rmSync(output, { recursive: true, force: true });
      },
    };
  }
  rmSync(output, { recursive: true, force: true });
  throw new Error(`No Python interpreter could generate TLS fixtures: ${failure || "not found"}`);
}
