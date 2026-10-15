/**
 * Deterministic grounding scorer for the fixture corpus.
 * Live-web scores are a separate gate and must not be inferred from this helper.
 */

function normalize(text) {
  return String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function pageMap(corpus) {
  return new Map((corpus.pages || []).map((page) => [page.snapshot_id, page]));
}

export function markdownForQuestion(corpus, question) {
  const pages = pageMap(corpus);
  return (question.snapshot_ids || [])
    .map((id) => pages.get(id))
    .filter(Boolean)
    .map((page) => `# ${page.url}\n\n${page.markdown}`)
    .join("\n\n");
}

export function fixtureAnswerer(corpus) {
  const pages = pageMap(corpus);
  return function answer(questionText, markdown) {
    const question = (corpus.questions || []).find((item) => item.question === questionText);
    if (!question) {
      return { answer: "", claims: [], citations: [], snapshot_ids: [] };
    }
    const haystack = normalize(markdown);
    if (question.expect === "not_found") {
      return {
        answer: "not found",
        claims: [{ claim_id: `${question.id}-nf`, statement: question.question, status: "not_found" }],
        citations: [],
        snapshot_ids: question.snapshot_ids || [],
      };
    }
    const claims = [];
    const citations = [];
    for (const fact of question.required_facts || []) {
      if (!haystack.includes(normalize(fact))) continue;
      const citation = (question.golden_citations || [])[0];
      const page = pages.get((question.snapshot_ids || [])[0]);
      claims.push({
        claim_id: `${question.id}-${claims.length + 1}`,
        statement: fact,
        status: "supported",
        source_url: citation?.url || page?.url || "",
        quote: citation?.quote || fact,
        snapshot_id: page?.snapshot_id || "",
      });
      if (citation?.url) citations.push({ url: citation.url, quote: citation.quote || fact });
    }
    return {
      answer: (question.required_facts || []).join(". "),
      claims,
      citations,
      snapshot_ids: question.snapshot_ids || [],
    };
  };
}

export function scoreGroundingRun(corpus, answers) {
  const pages = pageMap(corpus);
  const allowedUrls = new Set((corpus.pages || []).map((page) => page.url));
  const questions = corpus.questions || [];
  let factualHits = 0;
  let factualTotal = 0;
  let completeHits = 0;
  let completeTotal = 0;
  let entailmentHits = 0;
  let entailmentTotal = 0;
  let evidencedDirect = 0;
  let directTotal = 0;
  let invented = 0;
  const failures = [];

  for (const question of questions) {
    const answer = typeof answers.get === "function" ? answers.get(question.id) : answers[question.id];
    if (!answer) {
      failures.push({ id: question.id, reason: "missing_answer" });
      continue;
    }
    const facts = question.required_facts || [];
    if (question.expect === "not_found") {
      factualTotal += 1;
      completeTotal += 1;
      const ok = (answer.claims || []).some((claim) => claim.status === "not_found");
      if (ok) {
        factualHits += 1;
        completeHits += 1;
      } else failures.push({ id: question.id, reason: "expected_not_found" });
      continue;
    }
    const blob = normalize([answer.answer, ...(answer.claims || []).map((claim) => claim.statement)].join(" "));
    for (const fact of facts) {
      factualTotal += 1;
      completeTotal += 1;
      if (blob.includes(normalize(fact))) {
        factualHits += 1;
        completeHits += 1;
      }
    }
    for (const claim of answer.claims || []) {
      if (claim.status !== "supported") continue;
      directTotal += 1;
      const page = pages.get(claim.snapshot_id) || [...pages.values()].find((item) => item.url === claim.source_url);
      const quote = String(claim.quote || "");
      if (claim.source_url && quote && page && normalize(page.markdown).includes(normalize(quote))) {
        evidencedDirect += 1;
        entailmentTotal += 1;
        entailmentHits += 1;
      } else {
        entailmentTotal += 1;
        failures.push({ id: question.id, reason: "missing_evidence", claim: claim.claim_id });
      }
      if (claim.source_url && !allowedUrls.has(claim.source_url)) {
        invented += 1;
        failures.push({ id: question.id, reason: "invented_url", url: claim.source_url });
      }
    }
    for (const citation of answer.citations || []) {
      if (citation.url && !allowedUrls.has(citation.url)) {
        invented += 1;
        failures.push({ id: question.id, reason: "invented_citation", url: citation.url });
      }
    }
  }

  const gates = corpus.gates || {};
  const metrics = {
    scoreable: questions.length,
    factual_accuracy: factualTotal ? factualHits / factualTotal : 0,
    completeness: completeTotal ? completeHits / completeTotal : 0,
    citation_entailment: entailmentTotal ? entailmentHits / entailmentTotal : 1,
    direct_claims_with_evidence: directTotal ? evidencedDirect / directTotal : 1,
    invented_citations: invented,
    failures,
  };
  metrics.passed = questions.length >= 30
    && metrics.factual_accuracy >= (gates.factual_accuracy ?? 0.9)
    && metrics.completeness >= (gates.completeness ?? 0.9)
    && metrics.citation_entailment >= (gates.citation_entailment ?? 0.95)
    && metrics.direct_claims_with_evidence >= (gates.direct_claims_with_evidence ?? 1)
    && metrics.invented_citations === (gates.invented_citations ?? 0);
  return metrics;
}

export function runFixtureGrounding(corpus) {
  const answerer = fixtureAnswerer(corpus);
  const answers = {};
  for (const question of corpus.questions || []) {
    answers[question.id] = answerer(question.question, markdownForQuestion(corpus, question));
  }
  return scoreGroundingRun(corpus, answers);
}

function livePageEntries(pages) {
  if (Array.isArray(pages)) return pages;
  if (pages && typeof pages === "object") {
    return Object.entries(pages).map(([pageId, page]) => ({ page_id: pageId, ...page }));
  }
  return [];
}

function livePageMap(pages) {
  const out = new Map();
  for (const page of livePageEntries(pages)) {
    if (!page || typeof page !== "object") continue;
    if (page.page_id) out.set(String(page.page_id), page);
    if (page.id) out.set(String(page.id), page);
    if (page.url) out.set(String(page.url), page);
    if (page.final_url) out.set(String(page.final_url), page);
  }
  return out;
}

function canonicalLiveUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return "";
  }
}

function liveQuote(markdown, fact, evidenceTerms = []) {
  const source = String(markdown || "");
  const needle = String(fact || "").trim();
  if (!source || !needle) return "";
  const needleLower = needle.toLowerCase();
  const terms = [...new Set([needle, ...(evidenceTerms || [])].map((term) => String(term || "").trim()).filter(Boolean))];
  const candidates = [];
  for (const rawLine of source.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line || !line.toLowerCase().includes(needleLower)) continue;
    const lower = line.toLowerCase();
    const termsPresent = terms.filter((term) => lower.includes(term.toLowerCase())).length;
    let score = 0;
    if (line.length >= 24 && line.length <= 900) score += 8;
    if (/\b(?:is|are|was|were|stands for|original|author|capital|largest|country|continent|unit|term|museum|keys|language|charge|planets|package manager)\b/i.test(line)) score += 12;
    if (/^#{1,6}\s|^source:/i.test(line)) score -= 20;
    if (/redirected from|\{\{|\}\}|cite web|data-mw|"wt"|^\s*[-*]\s+(?:afrikaans|arabic|english|español)/i.test(line)) score -= 60;
    if (/^\|/.test(line)) score += 3;
    score += termsPresent * 18;
    if (termsPresent === terms.length) score += 100;
    candidates.push({ line, score, termsPresent });
  }
  candidates.sort((a, b) => b.score - a.score || a.line.length - b.line.length);
  const best = candidates.find((candidate) => candidate.termsPresent === terms.length);
  if (best) {
    const line = best.line.replace(/\s+/g, " ").trim();
    const lower = line.toLowerCase();
    const indexes = terms.map((term) => lower.indexOf(term.toLowerCase())).filter((index) => index >= 0);
    const start = Math.max(0, Math.min(...indexes) - 160);
    const end = Math.min(line.length, Math.max(...indexes.map((index, i) => index + terms[i].length)) + 220);
    return line.slice(start, end).trim().slice(0, 800);
  }
  if (terms.length > 1) return "";
  const at = source.toLowerCase().indexOf(needleLower);
  if (at < 0) return "";
  return source.slice(Math.max(0, at - 120), Math.min(source.length, at + needle.length + 180)).replace(/\s+/g, " ").trim().slice(0, 600);
}

function sourceAllowed(question, page, corpus) {
  const expected = canonicalLiveUrl(question?.source_url);
  const actual = canonicalLiveUrl(page?.final_url || page?.url);
  if (!expected || !actual || expected !== actual) return false;
  const policy = corpus?.source_policy || {};
  if (policy.require_https && !actual.startsWith("https://")) return false;
  const host = new URL(actual).hostname.toLowerCase();
  const allowed = (policy.allow_hosts || []).map((item) => String(item).toLowerCase());
  const rejected = (policy.reject_fixture_hosts || []).map((item) => String(item).toLowerCase());
  if (rejected.some((item) => host === item || host.endsWith(`.${item}`))) return false;
  return !allowed.length || allowed.some((item) => host === item || host.endsWith(`.${item}`));
}

/**
 * Build an auditable answer from pages fetched during the live run.
 * This is an evidence oracle, not an LLM accuracy claim: it only emits a
 * supported claim when the required literal fact and its local quote exist in
 * the page fetched for that question. Missing pages stay unavailable.
 */
export function liveGroundingOracle(corpus, pages) {
  const byKey = livePageMap(pages);
  const answers = {};
  for (const question of corpus?.questions || []) {
    const page = byKey.get(String(question.page_id || question.id))
      || byKey.get(String(question.source_url || ""));
    const markdown = String(page?.markdown || page?.text || "");
    const normalized = normalize(markdown);
    if (!page?.success || !markdown) {
      answers[question.id] = { answer: "", claims: [], citations: [], unavailable: true };
      continue;
    }
    if (question.expect === "not_found") {
      const negative = (question.negative_evidence || []).every((fact) => normalized.includes(normalize(fact)));
      answers[question.id] = negative
        ? {
            answer: "not found: the fetched evidence does not define a real-world value",
            claims: [{ claim_id: `${question.id}-nf`, statement: question.question, status: "not_found" }],
            citations: [],
          }
        : { answer: "", claims: [], citations: [], unavailable: true };
      continue;
    }
    const claims = [];
    const citations = [];
    for (const fact of question.required_facts || []) {
      const quote = liveQuote(markdown, fact, question.evidence_terms || []);
      if (!quote) continue;
      const url = page.final_url || page.url || question.source_url || "";
      claims.push({
        claim_id: `${question.id}-${claims.length + 1}`,
        statement: fact,
        status: "supported",
        source_url: url,
        quote,
        page_id: question.page_id || question.id,
      });
      citations.push({ url, quote });
    }
    answers[question.id] = {
      answer: claims.map((claim) => claim.statement).join(". "),
      claims,
      citations,
      page_id: question.page_id || question.id,
    };
  }
  return answers;
}

/**
 * Score a live run. Pages must contain success, final URL, Markdown, a
 * verified SHA-256 digest, and claims for every required fact. A fixture URL,
 * missing evidence, or unavailable page prevents a pass rather than turning
 * into a zero-cost hit.
 */
export function scoreLiveGroundingRun(corpus, answers, pages, options = {}) {
  const questions = corpus?.questions || [];
  const pageMap = livePageMap(pages);
  const fetched = livePageEntries(pages);
  const failures = [];
  let factualHits = 0;
  let factualTotal = 0;
  let completeHits = 0;
  let completeTotal = 0;
  let entailmentHits = 0;
  let entailmentTotal = 0;
  let evidencedDirect = 0;
  let directTotal = 0;
  let invented = 0;
  let unavailable = 0;
  const validPages = new Set();
  for (const page of fetched) {
    const pageId = String(page?.page_id || page?.id || "");
    const url = canonicalLiveUrl(page?.final_url || page?.url);
    const hash = String(page?.sha256 || "");
    const ok = Boolean(
      page?.success
      && page?.markdown
      && /^[0-9a-f]{64}$/i.test(hash)
      && page?.hash_verified === true
      && url,
    );
    if (ok) validPages.add(pageId || url);
    else failures.push({ id: pageId || url, reason: "invalid_live_page" });
  }
  for (const question of questions) {
    const answer = typeof answers?.get === "function" ? answers.get(question.id) : answers?.[question.id];
    const page = pageMap.get(String(question.page_id || question.id)) || pageMap.get(String(question.source_url || ""));
    const pageKey = String(question.page_id || question.id);
    if (!answer || answer.unavailable || !page || !validPages.has(pageKey)) {
      unavailable += 1;
      failures.push({ id: question.id, reason: "live_evidence_unavailable" });
      continue;
    }
    if (!sourceAllowed(question, page, corpus)) {
      unavailable += 1;
      failures.push({ id: question.id, reason: "live_source_not_allowed" });
      continue;
    }
    if (question.expect === "not_found") {
      factualTotal += 1;
      completeTotal += 1;
      const ok = (answer.claims || []).some((claim) => claim.status === "not_found");
      if (ok) { factualHits += 1; completeHits += 1; }
      else failures.push({ id: question.id, reason: "expected_not_found" });
      continue;
    }
    const blob = normalize([answer.answer, ...(answer.claims || []).map((claim) => claim.statement)].join(" "));
    let questionComplete = true;
    for (const fact of question.required_facts || []) {
      factualTotal += 1;
      completeTotal += 1;
      const hit = blob.includes(normalize(fact));
      if (hit) factualHits += 1;
      else { questionComplete = false; failures.push({ id: question.id, reason: "missing_fact", fact }); }
    }
    if (questionComplete) completeHits += question.required_facts?.length || 0;
    const supportedClaims = (answer.claims || []).filter((claim) => claim.status === "supported");
    const usedClaims = new Set();
    const pageUrl = canonicalLiveUrl(page.final_url || page.url);
    const validateClaim = (claim) => {
      directTotal += 1;
      const claimUrl = canonicalLiveUrl(claim.source_url);
      const quote = String(claim.quote || "");
      const sourceOk = claimUrl === pageUrl;
      const quoteOk = Boolean(quote && normalize(page.markdown || page.text).includes(normalize(quote)));
      entailmentTotal += 1;
      if (sourceOk && quoteOk) { evidencedDirect += 1; entailmentHits += 1; }
      else failures.push({ id: question.id, reason: "missing_or_unrelated_live_evidence", claim: claim.claim_id });
      if (claimUrl && !sourceOk) {
        invented += 1;
        failures.push({ id: question.id, reason: "invented_or_unallowlisted_url", url: claim.source_url });
      }
    };
    for (const fact of question.required_facts || []) {
      const factNeedle = normalize(fact);
      const claimIndex = supportedClaims.findIndex((claim, index) => (
        !usedClaims.has(index) && normalize(claim.statement).includes(factNeedle)
      ));
      if (claimIndex < 0) {
        directTotal += 1;
        entailmentTotal += 1;
        failures.push({ id: question.id, reason: "missing_claim_for_fact", fact });
        continue;
      }
      usedClaims.add(claimIndex);
      validateClaim(supportedClaims[claimIndex]);
    }
    for (const [index, claim] of supportedClaims.entries()) {
      if (!usedClaims.has(index)) validateClaim(claim);
    }
    for (const citation of answer.citations || []) {
      if (citation.url && canonicalLiveUrl(citation.url) !== canonicalLiveUrl(page.final_url || page.url)) {
        invented += 1;
        failures.push({ id: question.id, reason: "invented_citation", url: citation.url });
      }
    }
  }
  const gates = corpus?.gates || {};
  const metrics = {
    scoreable: questions.length,
    fetched_pages: fetched.length,
    unavailable_questions: unavailable,
    factual_accuracy: factualTotal ? factualHits / factualTotal : 0,
    completeness: completeTotal ? completeHits / completeTotal : 0,
    citation_entailment: entailmentTotal ? entailmentHits / entailmentTotal : 1,
    direct_claims_with_evidence: directTotal ? evidencedDirect / directTotal : 0,
    invented_citations: invented,
    failures,
    oracle: options.oracle || "live_fetch_evidence",
    model_accuracy_measured: false,
  };
  metrics.passed = questions.length >= Number(gates.min_scoreable ?? 30)
    && unavailable === 0
    && metrics.factual_accuracy >= Number(gates.factual_accuracy ?? 0.9)
    && metrics.completeness >= Number(gates.completeness ?? 0.9)
    && metrics.citation_entailment >= Number(gates.citation_entailment ?? 0.95)
    && metrics.direct_claims_with_evidence >= Number(gates.direct_claims_with_evidence ?? 1)
    && metrics.invented_citations === Number(gates.invented_citations ?? 0);
  return metrics;
}
