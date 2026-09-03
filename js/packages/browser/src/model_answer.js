/**
 * Deterministic model-answer judge for Browser 1.20.
 *
 * Scores a live provider answer transcript against the pages that were
 * actually fetched. No model, no network, no fallback: every gate is a
 * string/URL/set check and anything unverifiable fails closed.
 *
 * Snake_case wire format mirrors the Python implementation exactly.
 */

const URL_PATTERN = /https?:\/\/[^\s)"'\]]+/g;

function normalize(text) {
  return String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function stripTrailingPunctuation(url) {
  return String(url).replace(/[.,;:!?)\]]+$/u, "");
}

function answerUrls(answer) {
  const found = new Set();
  for (const match of String(answer ?? "").matchAll(URL_PATTERN)) {
    found.add(stripTrailingPunctuation(match[0]));
  }
  return found;
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * @param {object} transcript {question_id, question, model, answer, claims, citations, pages}
 * claim: {claim_id, statement, citation_urls}; citation: {url, quote}; page: {url, markdown}
 */
export function judgeModelAnswer(transcript) {
  const doc = transcript && typeof transcript === "object" ? transcript : {};
  const pages = new Map();
  for (const page of asList(doc.pages)) {
    if (page && typeof page.url === "string") pages.set(page.url, String(page.markdown ?? ""));
  }
  const citations = asList(doc.citations);
  const claims = asList(doc.claims);
  const gates = [];
  const push = (id, name, result, detail = "") => gates.push({ id, name, result, detail });

  const answer = String(doc.answer ?? "");
  push(
    "answer_present",
    "answer is non-empty",
    answer.trim() ? "pass" : "fail",
    answer.trim() ? "" : "empty answer text",
  );

  const citationVerdicts = citations.map((citation, index) => {
    const url = typeof citation?.url === "string" ? citation.url : "";
    const resolves = pages.has(url);
    const quoteOk = resolves && normalize(citation?.quote ?? "") !== "" &&
      normalize(pages.get(url)).includes(normalize(citation.quote));
    return { index, url, resolves, quoteOk };
  });
  const unresolved = citationVerdicts.filter((item) => !item.resolves);
  push(
    "citations_resolve",
    "every citation url was fetched",
    citations.length === 0
      ? (claims.length === 0 ? "pass" : "fail")
      : (unresolved.length === 0 ? "pass" : "fail"),
    unresolved.length === 0 ? "" : `unfetched: ${unresolved.map((item) => item.url).join(", ")}`,
  );

  const badQuotes = citationVerdicts.filter((item) => !item.quoteOk);
  push(
    "quotes_literal",
    "every citation quote matches its page literally",
    badQuotes.length === 0 ? "pass" : "fail",
    badQuotes.length === 0 ? "" : `mismatch at citation index ${badQuotes.map((item) => item.index).join(", ")}`,
  );

  const uncovered = [];
  for (const claim of claims) {
    const urls = asList(claim?.citation_urls).filter((url) => typeof url === "string" && url !== "");
    if (urls.length === 0 || urls.some((url) => !pages.has(url))) {
      uncovered.push(claim?.claim_id ?? "?");
    }
  }
  push(
    "claims_covered",
    "every claim points at fetched evidence",
    uncovered.length === 0 ? "pass" : "fail",
    uncovered.length === 0 ? "" : `uncovered: ${uncovered.join(", ")}`,
  );

  const invented = [...answerUrls(answer)].filter((url) => !pages.has(url));
  push(
    "no_invented_urls",
    "answer links only fetched pages",
    invented.length === 0 ? "pass" : "fail",
    invented.length === 0 ? "" : `invented: ${invented.join(", ")}`,
  );

  const passed = gates.filter((gate) => gate.result === "pass").length;
  return {
    format: "handoffkit.browser.model_answer_judgment",
    format_version: 1,
    question_id: doc.question_id ?? "",
    model: doc.model ?? "",
    gates,
    score: gates.length === 0 ? 0 : passed / gates.length,
    verdict: passed === gates.length ? "pass" : "fail",
    notice: "Deterministic judgment only; no claim beyond the fetched pages.",
  };
}
