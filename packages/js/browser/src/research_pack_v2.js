import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ResearchClaim, PageSnapshot } from "@handoffkit/browser-core";

export function sha256Utf8(text) {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

export function snapshotsFromPages(pages, extras = {}) {
  return (pages ?? []).map((page, index) => {
    const markdown = page.markdown || page.text || "";
    const url = page.final_url || page.finalUrl || page.url || "";
    return PageSnapshot.fromWire({
      snapshot_id: extras.snapshotIdPrefix ? `${extras.snapshotIdPrefix}-${index + 1}` : sha256Utf8(url + markdown).slice(0, 16),
      request_id: extras.requestId || extras.request_id || "",
      session_id: extras.sessionId || extras.session_id || "",
      url: page.url || url,
      final_url: url,
      fetched_at: extras.fetchedAt || new Date().toISOString(),
      sha256: sha256Utf8(markdown),
      content_type: "text/markdown",
      title: page.title || "",
      markdown,
      provenance: { product: extras.product || "lite", source: extras.source || "research" },
    }).toWire();
  });
}

export function notFoundClaim(query) {
  return ResearchClaim.fromWire({
    claim_id: "not-found",
    statement: String(query || "requested fact"),
    status: "not_found",
  }).toWire();
}

export function detectContradictions(claims) {
  const supported = (claims ?? []).filter((item) => item.status === "supported" && item.quote);
  const out = [];
  for (let i = 0; i < supported.length; i++) {
    for (let j = i + 1; j < supported.length; j++) {
      const a = supported[i];
      const b = supported[j];
      const aNot = /\bnot\b|\bno\b|\bnever\b/i.test(a.quote);
      const bNot = /\bnot\b|\bno\b|\bnever\b/i.test(b.quote);
      if (a.source_url !== b.source_url && aNot !== bNot) {
        const overlap = a.statement.toLowerCase().split(/\s+/).filter((word) => word.length > 4 && b.statement.toLowerCase().includes(word));
        if (overlap.length >= 2) {
          out.push({
            claim_ids: [a.claim_id, b.claim_id],
            urls: [a.source_url, b.source_url],
            reason: "conflicting_quotes",
          });
        }
      }
    }
  }
  return out;
}

export function finalizeResearchPackV2(pack) {
  pack.pack_version = 2;
  pack.selected_urls = pack.selected_urls?.length ? pack.selected_urls : [...(pack.urls_fetched ?? [])];
  if (!pack.snapshots?.length && pack.pages?.length) {
    pack.snapshots = snapshotsFromPages(pack.pages, { product: "lite", source: "research" });
  }
  pack.snapshots = pack.snapshots ?? [];
  pack.claims = pack.claims ?? [];
  if (!pack.claims.length && !(pack.pages ?? []).length) {
    pack.claims = [notFoundClaim(pack.queries?.[0] || pack.query || "")];
  }
  pack.contradictions = pack.contradictions?.length ? pack.contradictions : detectContradictions(pack.claims);
  pack.idempotency_key = pack.idempotency_key || pack.checkpoint_id || "";
  return pack;
}

export async function writeResearchCheckpoint(root, pack, extras = {}) {
  const dir = path.resolve(root);
  await mkdir(dir, { recursive: true });
  const key = extras.idempotencyKey || extras.idempotency_key || pack.idempotency_key || "default";
  const file = path.join(dir, `${String(key).replace(/[^a-zA-Z0-9._-]+/g, "_")}.json`);
  const payload = {
    contract_version: extras.contractVersion || "1.20.0-alpha.1",
    delivery: "at_least_once",
    idempotency_key: key,
    pack: typeof pack.toDict === "function" ? pack.toDict() : pack,
    written_at: new Date().toISOString(),
  };
  await writeFile(file, JSON.stringify(payload), "utf8");
  return { file, delivery: "at_least_once" };
}

export async function readResearchCheckpoint(root, idempotencyKey) {
  const file = path.join(path.resolve(root), `${String(idempotencyKey).replace(/[^a-zA-Z0-9._-]+/g, "_")}.json`);
  const payload = JSON.parse(await readFile(file, "utf8"));
  return payload;
}
