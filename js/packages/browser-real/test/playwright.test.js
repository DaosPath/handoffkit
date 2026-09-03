import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { BrowserRealService } from "../src/index.js";
import { ArtifactStore } from "../src/artifacts.js";
import { resolvePublicHost } from "../src/egress.js";

const enabled = process.env.HANDOFFKIT_BROWSER_REAL_PLAYWRIGHT === "1";

function html(body) {
  return `<!doctype html><html><head><title>fixture</title></head><body>${body}</body></html>`;
}

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

test("Playwright Chromium suite is explicit", { timeout: 90_000 }, async (t) => {
  if (!enabled) {
    t.diagnostic("HANDOFFKIT_BROWSER_REAL_PLAYWRIGHT is unset; this job is not Chromium evidence");
    return;
  }
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    throw new Error("Playwright is required when HANDOFFKIT_BROWSER_REAL_PLAYWRIGHT=1");
  }
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "hk-pw-artifacts-"));
  t.after(() => rm(artifactRoot, { recursive: true, force: true }));
  const hugeBytes = 51 * 1024 * 1024;
  const { server: crossServer, port: crossPort } = await listen((request, response) => {
    if (new URL(request.url, `http://127.0.0.1:${crossPort}`).pathname === "/frame") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html("<p id='inside'>cross-frame-ok</p>"));
      return;
    }
    response.writeHead(404);
    response.end("missing");
  });
  const { server, port } = await listen((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname === "/spa") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html(`
        <h1 id="title">spa</h1>
        <button id="go">go</button>
        <form><input id="q" name="q"><button id="submit" type="submit">send</button></form>
        <div id="host"></div>
        <iframe name="child" src="http://127.0.0.1:${crossPort}/frame"></iframe>
        <a id="popup" href="/popup" target="_blank">popup</a>
        <a id="dl" href="/file.txt" download>download</a>
        <a id="huge" href="/huge.bin" download>huge</a>
        <script>
          const host = document.getElementById("host");
          const shadow = host.attachShadow({ mode: "open" });
          shadow.innerHTML = "<span id='shadow'>shadow-ok</span>";
          document.getElementById("go").addEventListener("click", () => {
            document.getElementById("title").textContent = "spa-clicked";
          });
        </script>
      `));
      return;
    }
    if (url.pathname === "/frame") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html("<p id='inside'>frame-ok</p>"));
      return;
    }
    if (url.pathname === "/popup") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html("<p>popup-ok</p>"));
      return;
    }
    if (url.pathname === "/next") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html("<p>next-ok</p>"));
      return;
    }
    if (url.pathname === "/file.txt") {
      response.writeHead(200, {
        "content-type": "text/plain",
        "content-disposition": "attachment; filename=file.txt",
        "content-length": "14",
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      response.end("hello-download");
      return;
    }
    if (url.pathname === "/huge.bin") {
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": "attachment; filename=huge.bin",
        "content-length": String(hugeBytes),
      });
      if (String(request.method || "GET").toUpperCase() === "HEAD") {
        response.end();
        return;
      }
      response.end(Buffer.alloc(1, 1));
      return;
    }
    if (url.pathname === "/ssrf-subresource") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html("<img src='http://10.0.0.1/pixel' alt='private'>"));
      return;
    }
    if (url.pathname === "/ssrf-redirect") {
      response.writeHead(302, { location: "http://10.0.0.1/blocked" });
      response.end();
      return;
    }
    response.writeHead(404);
    response.end("missing");
  });
  const origin = `http://127.0.0.1:${port}`;
  const service = new BrowserRealService({
    policy: { network: { allow_loopback: true }, filesystem: { allow_write: true } },
    artifactStore: new ArtifactStore(artifactRoot),
  });
  t.after(async () => {
    for (const session of service.sessions.values()) {
      try {
        await Promise.race([
          Promise.resolve(session.handle?.close?.()),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
      } catch { /* ignore */ }
      if (session.handle?.pid) {
        spawnSync("taskkill", ["/F", "/PID", String(session.handle.pid), "/T"], { stdio: "ignore" });
      }
    }
    server.closeAllConnections?.();
    server.close();
    crossServer.closeAllConnections?.();
    crossServer.close();
  });
  const sessionId = "pw-1";
  t.diagnostic("session.start");
  await service.dispatch({
    command_id: "pw-start",
    session_id: sessionId,
    name: "session.start",
    payload: {
      product: "real",
      session_id: sessionId,
      policy: { network: { allow_loopback: true }, filesystem: { allow_write: true } },
    },
  });
  const navigated = await service.dispatch({
    command_id: "pw-nav",
    session_id: sessionId,
    name: "navigate",
    payload: { url: `${origin}/spa` },
  });
  assert.equal(navigated.name, "navigated");

  await service.dispatch({
    command_id: "pw-click",
    session_id: sessionId,
    name: "click",
    payload: { selector: "#go" },
  });
  const markdown = await service.dispatch({
    command_id: "pw-md",
    session_id: sessionId,
    name: "markdown",
    payload: {},
  });
  assert.match(String(markdown.payload.markdown || ""), /spa-clicked|spa/);
  assert.ok(markdown.payload.artifact_ref?.sha256);

  const located = await service.dispatch({
    command_id: "pw-shadow",
    session_id: sessionId,
    name: "locate",
    payload: { selector: "#shadow" },
  });
  assert.equal(located.payload.count >= 1, true);

  const framed = await service.dispatch({
    command_id: "pw-frame",
    session_id: sessionId,
    name: "locate",
    payload: { selector: "#inside", frame_name: "child" },
  });
  assert.equal(framed.payload.count >= 1, true);

  await service.dispatch({
    command_id: "pw-type",
    session_id: sessionId,
    name: "type",
    payload: { selector: "#q", text: "handoffkit" },
  });

  const popup = await service.dispatch({
    command_id: "pw-popup",
    session_id: sessionId,
    name: "click",
    payload: { selector: "#popup", expect_popup: true },
  });
  assert.equal(popup.payload.popup, true);

  await service.dispatch({
    command_id: "pw-next",
    session_id: sessionId,
    name: "navigate",
    payload: { url: `${origin}/next` },
  });
  const back = await service.dispatch({
    command_id: "pw-back",
    session_id: sessionId,
    name: "back",
    payload: {},
  });
  assert.equal(back.name, "navigated");

  const shot = await service.dispatch({
    command_id: "pw-shot",
    session_id: sessionId,
    name: "screenshot",
    payload: { authorize_preview: true },
  });
  assert.ok(shot.payload.artifact_ref?.sha256);
  assert.match(String(shot.payload.preview || ""), /^data:image\/png;base64,/);
  const digest = createHash("sha256");
  void digest;

  const pdf = await service.dispatch({
    command_id: "pw-pdf",
    session_id: sessionId,
    name: "pdf",
    payload: {},
  });
  assert.ok(pdf.payload.artifact_ref?.sha256 || pdf.payload.bytes >= 0);

  t.diagnostic("download");
  const download = await service.dispatch({
    command_id: "pw-dl",
    session_id: sessionId,
    name: "download",
    payload: { selector: "#dl" },
  });
  assert.equal(download.name, "download");
  assert.equal(download.payload.quarantined, true);

  t.diagnostic("download-huge");
  await assert.rejects(
    () => service.dispatch({
      command_id: "pw-huge",
      session_id: sessionId,
      name: "download",
      issued_at: new Date().toISOString(),
      deadline_at: new Date(Date.now() + 20_000).toISOString(),
      payload: { selector: "#huge" },
    }),
    (error) => error?.code === "download_too_large" || String(error?.message || "").includes("50"),
  );

  t.diagnostic("wait-deadline");
  const deadline = await service.dispatch({
    command_id: "pw-deadline",
    session_id: sessionId,
    name: "wait",
    issued_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() - 1000).toISOString(),
    payload: { selector: "#missing-never", timeout_ms: 1 },
  }).catch((error) => error);
  assert.equal(deadline?.code === "timeout" || deadline?.name === "error" || deadline instanceof Error, true);

  t.diagnostic("wait-deadline done");
  const ssrfSessionId = "pw-ssrf";
  await service.dispatch({
    command_id: "pw-ssrf-start",
    session_id: ssrfSessionId,
    name: "session.start",
    payload: {
      product: "real",
      session_id: ssrfSessionId,
      policy: {
        network: { allow_loopback: true, allow_private: false, allow_public: false },
        filesystem: { allow_write: true },
      },
    },
  });
  await assert.rejects(
    () => service.dispatch({
      command_id: "pw-ssrf-redirect",
      session_id: ssrfSessionId,
      name: "navigate",
      payload: { url: `${origin}/ssrf-redirect` },
    }),
    (error) => error?.code === "policy_denied",
  );
  await service.dispatch({
    command_id: "pw-ssrf-close",
    session_id: ssrfSessionId,
    name: "session.close",
    payload: {},
  });
  const ssrfSubresourceSessionId = "pw-ssrf-subresource";
  await service.dispatch({
    command_id: "pw-ssrf-subresource-start",
    session_id: ssrfSubresourceSessionId,
    name: "session.start",
    payload: {
      product: "real",
      session_id: ssrfSubresourceSessionId,
      policy: {
        network: { allow_loopback: true, allow_private: false, allow_public: false },
        filesystem: { allow_write: true },
      },
    },
  });
  await assert.rejects(
    () => service.dispatch({
      command_id: "pw-ssrf-subresource-navigate",
      session_id: ssrfSubresourceSessionId,
      name: "navigate",
      payload: { url: `${origin}/ssrf-subresource` },
    }),
    (error) => error?.code === "policy_denied",
  );
  await assert.rejects(
    () => resolvePublicHost("localhost"),
    (error) => error?.code === "policy_denied" && /non-global IP/i.test(String(error?.message || "")),
  );
  await service.dispatch({
    command_id: "pw-ssrf-subresource-close",
    session_id: ssrfSubresourceSessionId,
    name: "session.close",
    payload: {},
  });

  const session = service.sessions.get(sessionId);
  const browserProcess = session?.handle?.server?.process?.();
  if (browserProcess?.kill) {
    browserProcess.kill("SIGKILL");
  } else if (session?.handle?.browser?.close) {
    await session.handle.browser.close();
  } else if (session?.handle) {
    session.handle.dead = true;
  }
  t.diagnostic("browser disconnected");
  const crashed = await service.dispatch({
    command_id: "pw-crash",
    session_id: sessionId,
    name: "navigate",
    payload: { url: `${origin}/spa` },
  });
  t.diagnostic(`crashed ${crashed.name}`);
  assert.equal(crashed.name === "session.interrupted" || crashed.payload?.code === "engine_crash", true);
  t.diagnostic("retry after Chromium disconnect");
  const retried = await service.dispatch({
    command_id: "pw-retry",
    session_id: sessionId,
    name: "session.retry",
    payload: {},
  });
  assert.equal(retried.name, "session.retry");
  const restartedProcess = service.sessions.get(sessionId)?.handle?.server?.process?.();
  assert.ok(restartedProcess?.pid);
  await service.dispatch({
    command_id: "pw-close",
    session_id: sessionId,
    name: "session.close",
    payload: {},
  });
  await service.supervisor.closeOwned();
  await new Promise((resolve) => {
    const deadline = Date.now() + 2_000;
    const poll = () => {
      if (restartedProcess.exitCode != null || Date.now() >= deadline) resolve();
      else setTimeout(poll, 25);
    };
    poll();
  });
  assert.notEqual(restartedProcess.exitCode, null);
  t.diagnostic("owned Chromium process exited without an orphan");
});
