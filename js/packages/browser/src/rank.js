import { normalizeHost, parseUrl } from "./types.js";

const TRUSTED_HOST_SCORE = [
  ["wikipedia.org", 100],
  ["nih.gov", 95],
  ["nlm.nih.gov", 95],
  ["pubmed.ncbi.nlm.nih.gov", 95],
  ["ncbi.nlm.nih.gov", 94],
  ["fda.gov", 93],
  ["ema.europa.eu", 92],
  ["who.int", 90],
  ["drugs.com", 85],
  ["medlineplus.gov", 85],
  ["mayoclinic.org", 80],
  ["github.com", 75],
  ["pypi.org", 75],
  ["npmjs.com", 75],
  ["readthedocs.io", 70],
  ["docs.", 65],
  ["arxiv.org", 70],
  ["frontiersin.org", 60],
  ["nature.com", 70],
  ["sciencedirect.com", 55],
];

const LOW_TRUST = ["pinterest.", "facebook.com", "twitter.com", "x.com", "tiktok.com", "instagram.com"];

export function hostScore(url) {
  const host = normalizeHost(parseUrl(url).host);
  if (!host) return 0;
  for (const bad of LOW_TRUST) {
    if (host.includes(bad.replace(/\.$/, ""))) return 5;
  }
  let best = 40;
  for (const [pattern, score] of TRUSTED_HOST_SCORE) {
    if (host.includes(pattern) || host.startsWith(pattern)) {
      best = Math.max(best, score);
    }
  }
  if (host.endsWith(".edu") || host.endsWith(".gov")) best = Math.max(best, 88);
  return best;
}

export function rankSearchHits(hits = [], { allowHosts = [], denyHosts = [] } = {}) {
  const allow = (allowHosts || []).map((h) => normalizeHost(h)).filter(Boolean);
  const deny = (denyHosts || []).map((h) => normalizeHost(h)).filter(Boolean);

  const filtered = [];
  for (const hit of hits) {
    const host = normalizeHost(parseUrl(hit.url).host);
    if (!host) continue;
    if (deny.some((d) => host === d || host.endsWith(`.${d}`))) continue;
    if (allow.length && !allow.some((a) => host === a || host.endsWith(`.${a}`))) continue;
    filtered.push({
      title: hit.title || "",
      url: hit.url,
      score: hostScore(hit.url) + (hit.title ? 5 : 0),
      weight: Number(hit.weight ?? 1) || 0,
    });
  }
  filtered.sort((a, b) => b.weight - a.weight || b.score - a.score || a.url.localeCompare(b.url));
  return filtered.map(({ title, url, score }) => ({ title, url, score }));
}

export function filterUrlsByHosts(urls, { allowHosts = [], denyHosts = [] } = {}) {
  return rankSearchHits(
    (urls || []).map((url) => ({ title: "", url })),
    { allowHosts, denyHosts },
  ).map((h) => h.url);
}
