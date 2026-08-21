import { readFileSync, lstatSync, mkdirSync } from "node:fs";
import path from "node:path";

import { BrowserCoreError, BrowserPolicy } from "@handoffkit/browser-core";

export const CONFIG_ENV = "HANDOFFKIT_BROWSER_REAL_CONFIG";

function fail(message, details = {}) {
  throw new BrowserCoreError(message, { code: "invalid_request", details });
}

function requireFile(filePath, field) {
  const resolved = path.resolve(String(filePath ?? ""));
  let stat;
  try {
    stat = lstatSync(resolved);
  } catch {
    fail(`${field} does not exist`, { field, path: resolved });
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`${field} must be a regular file`, { field, path: resolved });
  }
  return resolved;
}

function requireDir(dirPath, field) {
  const resolved = path.resolve(String(dirPath ?? ""));
  mkdirSync(resolved, { recursive: true, mode: 0o700 });
  const stat = lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail(`${field} must be a regular directory`, { field, path: resolved });
  }
  return resolved;
}

function requireWritablePath(filePath, field) {
  const resolved = path.resolve(String(filePath ?? ""));
  if (!String(filePath ?? "").trim()) fail(`${field} is required`, { field });
  mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  return resolved;
}

export function loadBrowserRealConfig(source = process.env[CONFIG_ENV]) {
  const configPath = String(source ?? "").trim();
  if (!configPath) {
    throw new BrowserCoreError(
      `${CONFIG_ENV} is required and must point to a valid Browser Real config file`,
      { code: "invalid_request", details: { field: CONFIG_ENV } },
    );
  }
  const resolved = requireFile(configPath, CONFIG_ENV);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(resolved, "utf8"));
  } catch {
    fail("Browser Real config is not valid JSON", { path: resolved });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("Browser Real config must be an object", { path: resolved });
  }
  const endpoint = parsed.endpoint && typeof parsed.endpoint === "object" ? parsed.endpoint : {};
  const tls = parsed.tls && typeof parsed.tls === "object" ? parsed.tls : {};
  const host = String(endpoint.host ?? "").trim();
  const port = Number(endpoint.port ?? 0);
  if (!host || !Number.isInteger(port) || port < 0 || port > 65535) {
    fail("endpoint.host and endpoint.port are required", { field: "endpoint" });
  }
  const trustDomain = String(parsed.trust_domain ?? parsed.trustDomain ?? "").trim();
  if (!trustDomain) fail("trust_domain is required", { field: "trust_domain" });
  const grants = parsed.grants && typeof parsed.grants === "object" ? parsed.grants : null;
  if (!grants || Object.keys(grants).length === 0) {
    fail("grants by certificate fingerprint are required", { field: "grants" });
  }
    const policy = BrowserPolicy.fromWire({
      ...(parsed.policy ?? {}),
      bind: {
        ...((parsed.policy && parsed.policy.bind) || {}),
        allow_public_bind: Boolean(
          parsed.allow_public_bind
          ?? parsed.allowPublicBind
          ?? parsed.policy?.bind?.allow_public_bind
          ?? parsed.policy?.bind?.allowPublicBind,
        ),
      },
    });
  return {
    path: resolved,
    host,
    port,
    trustDomain,
    caPath: requireFile(tls.ca ?? tls.ca_path ?? tls.caPath, "tls.ca"),
    certPath: requireFile(tls.cert ?? tls.cert_path ?? tls.certPath, "tls.cert"),
    keyPath: requireFile(tls.key ?? tls.key_path ?? tls.keyPath, "tls.key"),
    grants,
    replayStore: requireWritablePath(parsed.replay_store ?? parsed.replayStore, "replay_store"),
    stateStore: requireDir(parsed.state_store ?? parsed.stateStore, "state_store"),
    artifactRoot: requireDir(parsed.artifact_root ?? parsed.artifactRoot, "artifact_root"),
    profileRoot: requireDir(parsed.profile_root ?? parsed.profileRoot, "profile_root"),
    policy,
    allowPublicBind: Boolean(parsed.allow_public_bind ?? parsed.allowPublicBind),
  };
}
