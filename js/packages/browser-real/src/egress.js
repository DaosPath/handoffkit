import dns from "node:dns/promises";
import net from "node:net";

import { BrowserCoreError, classifyNetworkTarget } from "@handoffkit/browser-core";

const BLOCKED_KINDS = new Set(["loopback", "private", "invalid", "filesystem"]);

export function isBlockedIp(address) {
  const ip = net.isIP(address);
  if (!ip) return true;
  const kind = classifyNetworkTarget(`http://${ip === 6 ? `[${address}]` : address}/`).kind;
  return BLOCKED_KINDS.has(kind) || kind !== "public";
}

export async function resolvePublicHost(hostname) {
  const host = String(hostname ?? "").trim().toLowerCase();
  if (!host) {
    throw new BrowserCoreError("hostname is required", { code: "invalid_request" });
  }
  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch (error) {
    throw new BrowserCoreError(`DNS lookup failed for ${host}`, {
      code: "policy_denied",
      details: { host, error: String(error?.message ?? error) },
    });
  }
  if (!records.length) {
    throw new BrowserCoreError(`DNS returned no addresses for ${host}`, {
      code: "policy_denied",
      details: { host },
    });
  }
  for (const record of records) {
    if (isBlockedIp(record.address)) {
      throw new BrowserCoreError(`DNS answer contained a non-global IP for ${host}`, {
        code: "policy_denied",
        details: { host, address: record.address },
      });
    }
  }
  return { host, addresses: records.map((item) => item.address), pinned: records[0].address };
}

export async function assertRemoteNavigable(url, policy, { allowData = false, resolveDns = true } = {}) {
  const target = classifyNetworkTarget(url);
  if (target.scheme === "data") {
    if (!allowData) {
      throw new BrowserCoreError("data: URLs are reserved for the internal probe", {
        code: "policy_denied",
        details: { url },
      });
    }
    return target;
  }
  if (target.scheme !== "http" && target.scheme !== "https") {
    throw new BrowserCoreError("remote navigation accepts only HTTP/HTTPS", {
      code: "policy_denied",
      details: { url, scheme: target.scheme },
    });
  }
  policy.assertNetworkUrl(url);
  if (target.kind === "loopback" || target.kind === "private") {
    return { ...target, pinned: net.isIP(target.host) ? target.host : "" };
  }
  if (!resolveDns) return target;
  if (net.isIP(target.host)) {
    if (isBlockedIp(target.host)) {
      throw new BrowserCoreError("literal non-global IP navigation is denied", {
        code: "policy_denied",
        details: { host: target.host },
      });
    }
    return { ...target, pinned: target.host };
  }
  const resolved = await resolvePublicHost(target.host);
  return { ...target, ...resolved };
}
