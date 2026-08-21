#include <handoffkit/demos/fusion/cases_medcase.hpp>
#include <handoffkit/demos/fusion/types.hpp>

#include <cstdlib>
#include <fstream>

namespace handoffkit {
namespace demos {
namespace fusion {

std::vector<BenchCase> builtin_sample_bench_cases() {
    // Exactly two tiny samples for offline smoke — not a corpus dump.
    return {
        BenchCase{
            "sample-aldosteronism",
            "synthetic-sample",
            "Research only. Resistant HTN, K 2.6, high aldosterone, low renin. "
            "Format: 1) primary diagnosis 2) differentials 3) findings 4) tests 5) confidence.",
            "primary aldosteronism",
            "tiny sample for offline tests",
        },
        BenchCase{
            "sample-cache",
            "synthetic-sample",
            "Explain in under 8 bullets why response caching helps multi-agent fusion under rate limits.",
            "cache",
            "tiny sample for soft scoring",
        },
    };
}

Result<std::vector<BenchCase>> load_bench_cases_json(const std::filesystem::path& path) {
    if (!std::filesystem::exists(path)) {
        return Result<std::vector<BenchCase>>::failure(
            Error::parse_error("bench json not found: " + path.string())
        );
    }
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        return Result<std::vector<BenchCase>>::failure(
            Error::parse_error("cannot open: " + path.string())
        );
    }
    std::string body((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    try {
        const auto j = nlohmann::json::parse(body);
        if (!j.is_array()) {
            return Result<std::vector<BenchCase>>::failure(Error::parse_error("expected JSON array"));
        }
        std::vector<BenchCase> out;
        out.reserve(j.size());
        for (const auto& item : j) {
            if (!item.is_object()) continue;
            BenchCase c;
            c.case_id = item.value("case_id", "");
            c.source = item.value("pmcid", item.value("source", ""));
            if (!c.source.empty() && c.source.rfind("PMC", 0) == 0) {
                c.source = "MedCaseReasoning/" + c.source;
            }
            const std::string raw_prompt =
                item.value("case_prompt", item.value("prompt", ""));
            c.prompt =
                "Research only; not clinical advice.\nVignette:\n" + raw_prompt +
                "\nRequired output: primary diagnosis, differentials, key findings, next tests, "
                "and confidence.";
            c.gold_label = item.value("final_diagnosis", item.value("gold_label", ""));
            c.notes = item.value("title", item.value("notes", ""));
            if (c.case_id.empty() || c.prompt.empty()) continue;
            out.push_back(std::move(c));
        }
        return out;
    } catch (const std::exception& ex) {
        return Result<std::vector<BenchCase>>::failure(
            Error::parse_error(std::string("bench json: ") + ex.what())
        );
    }
}

namespace {
std::vector<BenchCase> load_or_builtin() {
    const char* env = std::getenv("HANDOFFKIT_MEDCASE_JSON");
    if (env && *env) {
        auto loaded = load_bench_cases_json(env);
        if (loaded && !loaded.value().empty()) return loaded.value();
    }
    // Optional well-known monorepo path (runtime only — not compiled into LOC)
    const std::filesystem::path candidates[] = {
        "packages/python/handoffkit/benchmarks/data/doctor_cases_30.json",
        "../packages/python/handoffkit/benchmarks/data/doctor_cases_30.json",
        "../../packages/python/handoffkit/benchmarks/data/doctor_cases_30.json",
    };
    for (const auto& p : candidates) {
        auto loaded = load_bench_cases_json(p);
        if (loaded && !loaded.value().empty()) return loaded.value();
    }
    return builtin_sample_bench_cases();
}
}  // namespace

std::vector<BenchCase> all_medcase_bench_cases() {
    static const auto cases = load_or_builtin();
    return cases;
}

const BenchCase* find_medcase_bench_case(std::string_view case_id) {
    static const auto cases = load_or_builtin();
    for (const auto& c : cases) {
        if (c.case_id == case_id) return &c;
    }
    return nullptr;
}

std::size_t medcase_bench_case_count() {
    static const auto n = load_or_builtin().size();
    return n;
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
