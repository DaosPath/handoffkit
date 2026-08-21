import { ClinicalScore } from "./models.js";
import { ClinicalError } from "./wire.js";

function normalize(text) {
  return String(text || "").toLowerCase().split(/\s+/).join(" ");
}

export function aliasMatch(predicted, gold, aliases = []) {
  const pred = normalize(predicted);
  const goldN = normalize(gold);
  if (!pred || !goldN) return false;
  if (pred === goldN) return true;
  return aliases.some((alias) => normalize(alias) && normalize(alias) === pred);
}

function regressionFlags(predicted, goldDoc = {}) {
  const gold = String(goldDoc.final_diagnosis || "");
  const aliases = Array.isArray(goldDoc.aliases) ? goldDoc.aliases : [];
  const exact = Boolean(String(predicted || "").trim()) && normalize(predicted) === normalize(gold);
  const aliased = aliasMatch(predicted, gold, aliases);
  return { exact, aliased };
}

export function scoreRun(run, judges = undefined, options = {}) {
  let goldDoc = { ...(options.gold || {}) };
  if (options.vault) goldDoc = options.vault.get(run.run_id) || goldDoc;
  const { exact, aliased } = regressionFlags(run.diagnosis, goldDoc);

  if (run.replay) {
    return new ClinicalScore({
      correct: false,
      judge_scores: [],
      alias_match: aliased,
      exact_match: exact,
      complete: true,
      quorum: 0,
      heuristic_only: true,
      scoring_mode: "gold_replay",
    });
  }
  if (!run.scoring_eligible) {
    return new ClinicalScore({
      correct: false,
      judge_scores: [],
      alias_match: aliased,
      exact_match: exact,
      complete: true,
      quorum: 0,
      heuristic_only: true,
      scoring_mode: "ineligible",
    });
  }
  if (judges == null) {
    return new ClinicalScore({
      correct: false,
      judge_scores: [],
      alias_match: aliased,
      exact_match: exact,
      complete: true,
      quorum: 0,
      heuristic_only: true,
      scoring_mode: "heuristic_regression",
    });
  }

  const scores = [];
  for (const judge of judges) {
    try {
      scores.push(Number(judge(run)));
    } catch {
      return new ClinicalScore({
        correct: false,
        judge_scores: scores,
        alias_match: aliased,
        exact_match: exact,
        complete: false,
        quorum: scores.length,
        heuristic_only: false,
        scoring_mode: "independent_judges",
      });
    }
  }
  if (scores.length < 3) {
    return new ClinicalScore({
      correct: false,
      judge_scores: scores,
      alias_match: aliased,
      exact_match: exact,
      complete: false,
      quorum: scores.length,
      heuristic_only: false,
      scoring_mode: "independent_judges",
    });
  }
  const voted = scores.filter((item) => item >= 4).length >= 2;
  return new ClinicalScore({
    correct: Boolean(voted),
    judge_scores: scores.slice(0, 3),
    alias_match: aliased,
    exact_match: exact,
    complete: true,
    quorum: 3,
    heuristic_only: false,
    scoring_mode: "independent_judges",
  });
}

export function requireOfficialComplete(results, expected = 897) {
  if (results.length !== expected) {
    throw new ClinicalError(`official run requires exactly ${expected} results`, {
      code: "run_incomplete",
      details: { count: results.length, expected },
    });
  }
  if (results.some((item) => item.status !== "complete")) {
    throw new ClinicalError("official run contains incomplete cases", { code: "run_incomplete" });
  }
  const missing = results.filter((item) => {
    const score = item.score || {};
    return Number(score.quorum || 0) < 3
      || score.heuristic_only
      || score.scoring_mode !== "independent_judges";
  });
  if (results.some((item) => (item.score || {}).clinical_validity != null)) {
    throw new ClinicalError("clinical validity claims cannot be published", { code: "run_incomplete" });
  }
  if (missing.length) {
    throw new ClinicalError("official run missing three independent judges", {
      code: "judge_quorum_missing",
      details: { count: missing.length },
    });
  }
}
