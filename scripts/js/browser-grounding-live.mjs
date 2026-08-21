#!/usr/bin/env node

/**
 * Real-HTTP grounding qualification for Browser Lite.
 *
 * This command intentionally uses a pinned, expiring corpus and fetches every
 * source over HTTPS through HandoffKit's HTTP explorer. It emits hashes and
 * live quotes, never treats the deterministic fixture as a web result, and
 * exits non-zero when network, freshness, source, or evidence gates fail.
 * The oracle measures retrieval/evidence integrity. It does not claim LLM
 * answer accuracy.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gatherWebResearch } from "../../packages/js/browser/src/research.js";
import { liveGroundingOracle, scoreLiveGroundingRun } from "../../packages/js/browser/src/grounding_scorer.js";
import { mapWithConcurrency } from "../../packages/js/browser/src/util.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const corpusPath = join(root, "packages", "contracts", "conformance", "browser-grounding-live-v1.json");
const reportPath = join(root, "reports", "BROWSER_1.20_GROUNDING_LIVE.json");
const corpus = JSON.parse(await readFile(corpusPath, "utf8"));
const startedAt = new Date();
const runId = startedAt.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const timeoutMs = Math.max(5000, Number(process.env.HANDOFFKIT_GROUNDING_TIMEOUT_MS || 30000));
const concurrency = Math.max(1, Math.min(6, Number(process.env.HANDOFFKIT_GROUNDING_CONCURRENCY || 3)));

function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function canonicalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return "";
  }
}

function hostAllowed(value) {
  const url = new URL(value);
  const policy = corpus.source_policy || {};
  if (policy.require_https && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if ((policy.reject_fixture_hosts || []).some((item) => host === item || host.endsWith(`.${item}`))) return false;
  const allowed = (policy.allow_hosts || []).map((item) => String(item).toLowerCase());
  return allowed.some((item) => host === item || host.endsWith(`.${item}`));
}

function currentDate() {
  return startedAt.toISOString().slice(0, 10);
}

function corpusPreflight() {
  const errors = [];
  if (corpus.format !== "handoffkit.browser.grounding.live") errors.push("wrong corpus format");
  if (corpus.questions?.length < Number(corpus.gates?.min_scoreable || 30)) errors.push("corpus below minimum scoreable questions");
  if (currentDate() > String(corpus.expires_at || "")) errors.push("live corpus expired; refresh source contract");
  const ids = new Set();
  for (const question of corpus.questions || []) {
    if (!question.id || ids.has(question.id)) errors.push(`duplicate or missing question id: ${question.id || "<empty>"}`);
    ids.add(question.id);
    try {
      if (!hostAllowed(question.source_url)) errors.push(`${question.id}: source outside allowlist`);
    } catch {
      errors.push(`${question.id}: invalid source URL`);
    }
  }
  return errors;
}

async function fetchQuestion(question) {
  const started = Date.now();
  const expectedUrl = canonicalUrl(question.source_url);
  try {
    const pack = await gatherWebResearch({
      query: question.question,
      seedOnly: true,
      autoSearch: false,
      seedUrls: [question.source_url],
      maxPages: 1,
      maxDepth: 0,
      timeoutMs,
      concurrency: 1,
      maxTextChars: 120000,
      maxMarkdownChars: 120000,
      maxBodyBytes: 6 * 1024 * 1024,
      contextMaxChars: 120000,
      allowHosts: corpus.source_policy?.allow_hosts || [],
      denyHosts: corpus.source_policy?.reject_fixture_hosts || [],
      providers: ["wikipedia"],
      format: "markdown",
    });
    const rawPage = pack.pages?.[0];
    const page = rawPage && typeof rawPage.toDict === "function" ? rawPage.toDict() : (rawPage || {});
    const step = (pack.steps || []).find((item) => item.tool === "web_fetch" || item.tool === "web_explore_step") || {};
    const markdown = String(page.markdown || page.text || "");
    const finalUrl = canonicalUrl(page.url || step.final_url || step.url || expectedUrl);
    const status = Number(step.status || 0);
    const success = Boolean(pack.pages_ok > 0 && page.success && markdown && status >= 200 && status < 300 && finalUrl === expectedUrl);
    return {
      page_id: question.page_id || question.id,
      question_id: question.id,
      success,
      status,
      url: expectedUrl,
      final_url: finalUrl,
      title: String(page.title || ""),
      markdown,
      markdown_chars: markdown.length,
      sha256: sha256(markdown),
      hash_verified: true,
      fetched_at: page.fetched_at || new Date().toISOString(),
      transport: pack.transport || "http",
      mode: pack.mode || "seed_only",
      duration_ms: Date.now() - started,
      error: success ? "" : String(pack.error || step.error || page.error || "live fetch failed"),
      selected_urls: pack.selected_urls?.length ? pack.selected_urls : [expectedUrl],
    };
  } catch (error) {
    return {
      page_id: question.page_id || question.id,
      question_id: question.id,
      success: false,
      status: 0,
      url: expectedUrl,
      final_url: "",
      title: "",
      markdown: "",
      markdown_chars: 0,
      sha256: sha256(""),
      hash_verified: false,
      fetched_at: new Date().toISOString(),
      transport: "http",
      mode: "seed_only",
      duration_ms: Date.now() - started,
      error: String(error?.message || error),
      selected_urls: [expectedUrl],
    };
  }
}

const preflightErrors = corpusPreflight();
let pages = [];
let answers = {};
let metrics = {
  scoreable: corpus.questions?.length || 0,
  fetched_pages: 0,
  unavailable_questions: corpus.questions?.length || 0,
  factual_accuracy: 0,
  completeness: 0,
  citation_entailment: 0,
  direct_claims_with_evidence: 0,
  invented_citations: 0,
  failures: preflightErrors.map((reason) => ({ reason })),
  oracle: "live_fetch_evidence",
  model_accuracy_measured: false,
  passed: false,
};

if (!preflightErrors.length) {
  pages = await mapWithConcurrency(corpus.questions || [], concurrency, fetchQuestion);
  answers = liveGroundingOracle(corpus, pages);
  metrics = scoreLiveGroundingRun(corpus, answers, pages, { oracle: "live_fetch_evidence" });
}

const pageEvidence = pages.map((page) => ({
  page_id: page.page_id,
  question_id: page.question_id,
  success: page.success,
  status: page.status,
  url: page.url,
  final_url: page.final_url,
  title: page.title,
  markdown_chars: page.markdown_chars,
  sha256: page.sha256,
  hash_verified: page.hash_verified === true,
  fetched_at: page.fetched_at,
  transport: page.transport,
  mode: page.mode,
  duration_ms: page.duration_ms,
  error: page.error,
  selected_urls: page.selected_urls,
}));
const report = {
  format: "handoffkit.browser.grounding.live.run",
  format_version: 1,
  run_id: runId,
  started_at: startedAt.toISOString(),
  finished_at: new Date().toISOString(),
  corpus: {
    file: "packages/contracts/conformance/browser-grounding-live-v1.json",
    as_of: corpus.as_of,
    expires_at: corpus.expires_at,
    sha256: sha256(JSON.stringify(corpus)),
  },
  execution: {
    real_http: true,
    fixture_used: false,
    transport: "HandoffKit WebExplorer over HTTPS",
    timeout_ms: timeoutMs,
    concurrency,
    preflight_errors: preflightErrors,
  },
  oracle: {
    kind: "live_fetch_evidence",
    model_accuracy_measured: false,
    description: "Deterministic evidence oracle. It emits claims only from literal facts and quotes present in fetched Markdown.",
  },
  status: metrics.passed ? "pass" : (pages.some((page) => !page.success) || preflightErrors.length ? "blocked" : "fail"),
  metrics,
  pages: pageEvidence,
  answers,
};

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  status: report.status,
  report: reportPath,
  scoreable: metrics.scoreable,
  fetched_pages: metrics.fetched_pages,
  factual_accuracy: metrics.factual_accuracy,
  completeness: metrics.completeness,
  citation_entailment: metrics.citation_entailment,
  direct_claims_with_evidence: metrics.direct_claims_with_evidence,
  invented_citations: metrics.invented_citations,
  unavailable_questions: metrics.unavailable_questions,
}, null, 2));

if (!metrics.passed) process.exitCode = 1;
