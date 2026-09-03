#include <handoffkit/demos/fusion/bench.hpp>
#include <handoffkit/demos/fusion/cases_medcase.hpp>

#include <sstream>

namespace handoffkit {
namespace demos {
namespace fusion {

nlohmann::json BenchCase::to_json() const {
    return nlohmann::json{
        {"case_id", case_id},
        {"source", source},
        {"prompt", prompt},
        {"gold_label", gold_label},
        {"notes", notes},
    };
}

nlohmann::json BenchCaseResult::to_json() const {
    return nlohmann::json{
        {"case", cse.to_json()},
        {"run", run.to_json()},
        {"score", score.to_json()},
        {"gold_hit", gold_hit},
    };
}

nlohmann::json BenchBatchResult::to_json() const {
    nlohmann::json arr = nlohmann::json::array();
    for (const auto& r : results) arr.push_back(r.to_json());
    return nlohmann::json{{"results", std::move(arr)}, {"metrics", metrics.to_json()}};
}

std::string BenchBatchResult::to_markdown() const {
    std::ostringstream ss;
    ss << "# Fusion bench batch\n\n" << metrics.to_markdown() << "\n";
    ss << "| case_id | success | gold_hit | llm_calls | wall_ms |\n|---|---|---|---:|---:|\n";
    for (const auto& r : results) {
        ss << "| " << r.cse.case_id
           << " | " << (r.run.success ? "Y" : "N")
           << " | " << (r.gold_hit ? "Y" : "N")
           << " | " << r.run.metrics.llm_calls
           << " | " << r.run.metrics.wall_ms << " |\n";
    }
    return ss.str();
}

std::vector<BenchCase> embedded_bench_cases() {
    // Small rich fixtures (MedCaseReasoning-style), not a 10k dump.
    return {
        BenchCase{
            "medcase-0006",
            "MedCaseReasoning/PMC7362425",
            "Research only. 48yo man African descent, unresponsive after GTCS, BP 178/121, GCS 3, intubated. "
            "Resistant HTN 20y (atenolol, spironolactone, amlodipine, valsartan, poor compliance); T2DM. "
            "K 2.6, metabolic alkalosis, aldosterone 36.2 ng/dL (high), renin <0.081 (low). "
            "Brain CT/MRI/EEG normal. Cushing and pheo excluded. Renovascular excluded. "
            "Format: 1) primary diagnosis 2) top 3 differentials 3) key findings 4) next 3 tests 5) confidence 0-100.",
            "primary aldosteronism",
            "Conn syndrome / primary aldosteronism gold",
        },
        BenchCase{
            "medcase-0000",
            "MedCaseReasoning/PMC8777167",
            "Research only. 52yo man with Addison on steroids, lateral epicondylitis. After gardening on cloudy summer day: "
            "severe redness elbow, burning, then blisters/crust. GP treated as cellulitis with dicloxacillin; then trunk rash. "
            "Labs normal CRP/CBC. What is the primary diagnosis of the elbow reaction?",
            "phototoxic reaction",
            "phototoxic drug reaction topical NSAID context",
        },
        BenchCase{
            "toy-cache-1",
            "synthetic",
            "Explain in 5 bullets why response caching helps multi-agent fusion under API rate limits.",
            "cache",
            "soft gold: should mention cache/rate",
        },
        BenchCase{
            "toy-merge-1",
            "synthetic",
            "Two agents disagree: A says use JSON wire snake_case; B says protobuf. Merge into one recommendation for HandoffKit C++.",
            "json",
            "soft gold prefers existing JSON wire",
        },
    };
}

const BenchCase* find_bench_case(std::string_view case_id) {
    static const auto cases = embedded_bench_cases();
    for (const auto& c : cases) {
        if (c.case_id == case_id) return &c;
    }
    if (auto* m = find_medcase_bench_case(case_id)) return m;
    return nullptr;
}

Result<BenchCaseResult> run_bench_case(const BenchCase& cse, FusionConfig base) {
    base.task = cse.prompt;
    if (base.profile == FusionProfileId::Shipping && base.extra.value("force_profile", false) == false) {
        // diagnostic tasks default to diagnostic profile unless forced
        if (cse.case_id.find("medcase") != std::string::npos) {
            base.profile = FusionProfileId::Diagnostic;
        }
    }
    auto run = run_fusion(base);
    if (!run) return run.error();
    BenchCaseResult out;
    out.cse = cse;
    out.run = std::move(run.value());
    out.score = score_text_against_gold(out.run.final_output, cse.gold_label);
    out.gold_hit = out.score.contains_normalized_gold || out.score.containment >= 0.5;
    out.run.metrics.scores = score_fusion_run(out.run, cse.gold_label);
    return out;
}

Result<BenchBatchResult> run_bench_batch(const std::vector<std::string>& case_ids, FusionConfig base) {
    BenchBatchResult batch;
    std::vector<std::string> ids = case_ids;
    if (ids.empty()) {
        for (const auto& c : embedded_bench_cases()) ids.push_back(c.case_id);
    }
    for (const auto& id : ids) {
        const auto* cse = find_bench_case(id);
        if (!cse) {
            return Error::invalid_argument("unknown bench case: " + id, "case_id");
        }
        auto one = run_bench_case(*cse, base);
        if (!one) return one.error();
        batch_metrics_add(batch.metrics, one.value().run, one.value().gold_hit);
        batch.results.push_back(std::move(one.value()));
    }
    return batch;
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
