import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const fixture = fileURLToPath(new URL(
  "../../../shared/contracts/test-fixtures/security/studio-security-events-v1.ndjson",
  import.meta.url,
));
const port = 3219;
const server = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: appRoot,
  env: {
    ...process.env,
    HANDOFFKIT_STUDIO_SECURITY_EVENTS: fixture,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let diagnostics = "";
server.stdout.on("data", (chunk) => { diagnostics += String(chunk); });
server.stderr.on("data", (chunk) => { diagnostics += String(chunk); });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Studio server exited early: ${diagnostics}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/studio/security`);
      if (response.ok) return response;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Studio server did not start: ${diagnostics}`);
}

try {
  const response = await waitForServer();
  const html = await response.text();
  assert.match(html, /<html[^>]+lang="en"/);
  assert.match(html, /<main[^>]+id="security-content"/);
  assert.match(html, /<h1[^>]*id="security-title"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /aria-label="Scrollable authenticated sessions table"/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /Certificate SAN/);
  assert.match(html, /sha256:0123456789ab/);
  assert.doesNotMatch(html, /-----BEGIN (?:PRIVATE KEY|CERTIFICATE)-----/);
  assert.doesNotMatch(html, /HANDOFFKIT_STUDIO_SECURITY_EVENTS=.*(?:\\|\/)/);

  const api = await fetch(`http://127.0.0.1:${port}/api/studio/security`);
  assert.equal(api.headers.get("cache-control"), "private, no-store, max-age=0");
  const snapshot = await api.json();
  assert.equal(snapshot.source.status, "connected");
  assert.equal(snapshot.sessions[0].identity_source, "certificate-san");
  assert.equal(JSON.stringify(snapshot).includes(fixture), false);
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) resolve();
    else server.once("exit", resolve);
  });
}
