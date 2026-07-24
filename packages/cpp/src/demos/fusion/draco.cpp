#include <handoffkit/demos/fusion/draco.hpp>

#include <handoffkit/demos/fusion/engine.hpp>
#include <handoffkit/demos/fusion/hash.hpp>
#include <handoffkit/runtime/providers.hpp>
#include <handoffkit/runtime/structured.hpp>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cctype>
#include <fstream>
#include <iomanip>
#include <limits>
#include <sstream>
#include <unordered_set>

namespace handoffkit {
namespace demos {
namespace fusion {
namespace {

using Clock = std::chrono::steady_clock;

std::string trim_copy(std::string value) {
    const auto not_space = [](unsigned char c) { return !std::isspace(c); };
    value.erase(value.begin(), std::find_if(value.begin(), value.end(), not_space));
    value.erase(std::find_if(value.rbegin(), value.rend(), not_space).base(), value.end());
    return value;
}

std::string upper_copy(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return static_cast<char>(std::toupper(c));
    });
    return value;
}

std::string lower_copy(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return value;
}

std::string normalize_verdict(std::string value) {
    value = upper_copy(trim_copy(std::move(value)));
    if (value == "MET" || value == "YES" || value == "TRUE" || value == "PASS" ||
        value == "SATISFIED") {
        return "MET";
    }
    if (value == "UNMET" || value == "NO" || value == "FALSE" || value == "FAIL" ||
        value == "UNSATISFIED") {
        return "UNMET";
    }
    return {};
}

std::string safe_component(std::string value) {
    for (char& c : value) {
        const unsigned char u = static_cast<unsigned char>(c);
        if (!(std::isalnum(u) || c == '-' || c == '_')) c = '_';
    }
    while (value.find("__") != std::string::npos) {
        value.replace(value.find("__"), 2, "_");
    }
    if (value.empty()) value = "unknown";
    if (value.size() > 40) value.resize(40);
    return value;
}

std::string task_dir_name(std::size_t index, const std::string& domain) {
    std::ostringstream ss;
    ss << "task-" << std::setw(3) << std::setfill('0') << index << "_" << safe_component(domain);
    return ss.str();
}

Result<std::string> read_text_file(const std::filesystem::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return Error::invalid_argument("cannot read file: " + path.string());
    return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

Result<void> write_text_file(const std::filesystem::path& path, const std::string& text) {
    std::error_code ec;
    std::filesystem::create_directories(path.parent_path(), ec);
    if (ec) return Result<void>::failure(Error::invalid_argument("cannot create directory: " + path.parent_path().string()));
    const auto tmp = path.string() + ".tmp";
    {
        std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
        if (!out) return Result<void>::failure(Error::invalid_argument("cannot write file: " + tmp));
        out.write(text.data(), static_cast<std::streamsize>(text.size()));
        if (!out) return Result<void>::failure(Error::invalid_argument("failed writing file: " + tmp));
    }
    std::filesystem::remove(path, ec);
    ec.clear();
    std::filesystem::rename(tmp, path, ec);
    if (ec) {
        std::filesystem::remove(tmp);
        return Result<void>::failure(Error::invalid_argument("cannot replace file: " + path.string()));
    }
    return Result<void>::success();
}

Result<void> write_json_file(const std::filesystem::path& path, const nlohmann::json& value) {
    return write_text_file(path, value.dump(2) + "\n");
}

Result<nlohmann::json> read_json_file(const std::filesystem::path& path) {
    auto text = read_text_file(path);
    if (!text) return text.error();
    try {
        return nlohmann::json::parse(text.value());
    } catch (const std::exception& ex) {
        return Error::parse_error("invalid JSON in " + path.string() + ": " + ex.what());
    }
}

bool looks_like_stub(const std::string& text) {
    const std::string stripped = trim_copy(text);
    if (stripped.size() < 600) return true;
    const std::string low = lower_copy(stripped);
    const std::vector<std::string> markers = {
        "i'll research", "i will research", "i'll pull", "i will pull", "let me search",
        "i need to look up", "as an ai i cannot browse", "i don't have access to the internet",
    };
    for (const auto& marker : markers) {
        if (low.find(marker) != std::string::npos && stripped.size() < 2500) return true;
    }
    return false;
}

std::string research_prompt(const std::string& problem) {
    return
        "You are writing the FINAL deep-research answer now. You have no tools and no web search.\n"
        "Rules:\n"
        "- Produce a complete, self-contained answer in this single response.\n"
        "- Do not promise future research or ask clarifying questions.\n"
        "- Lead with the direct answer, then structured analysis and residual uncertainty.\n"
        "- Use concrete names, numbers, comparisons, and caveats where supported.\n"
        "- Never fabricate citations, sources, or access to current data.\n\n"
        "TASK:\n" + problem + "\n";
}

DracoScore score_from_json(const nlohmann::json& j) {
    DracoScore score;
    if (!j.is_object()) return score;
    score.raw_score = j.value("raw_score", 0.0);
    score.positive_weight_sum = j.value("positive_weight_sum", 0.0);
    score.normalized_score_pct = j.value("normalized_score_pct", 0.0);
    score.n_criteria = j.value("n_criteria", std::size_t{0});
    score.n_judged = j.value("n_judged", std::size_t{0});
    score.n_missing = j.value("n_missing", std::size_t{0});
    score.met_positive = j.value("met_positive", std::size_t{0});
    score.unmet_positive = j.value("unmet_positive", std::size_t{0});
    score.met_negative_penalties = j.value("met_negative_penalties", std::size_t{0});
    score.unmet_negative = j.value("unmet_negative", std::size_t{0});
    score.details = j.value("details", nlohmann::json::array());
    return score;
}

nlohmann::json criteria_for_prompt(const std::vector<const DracoCriterion*>& criteria) {
    nlohmann::json out = nlohmann::json::array();
    for (const auto* criterion : criteria) {
        out.push_back({
            {"criterion_id", criterion->id},
            {"section", criterion->section_id + " / " + criterion->section_title},
            {"weight", criterion->weight},
            {"weight_meaning", criterion->weight >= 0.0
                ? "POSITIVE: MET when the response satisfies the requirement"
                : "NEGATIVE: MET when the described error or harm is present"},
            {"requirement", criterion->requirement},
        });
    }
    return out;
}

std::string judge_prompt(
    const DracoTask& task,
    const std::string& answer,
    const std::vector<const DracoCriterion*>& criteria,
    std::size_t problem_limit,
    std::size_t answer_limit,
    bool strict_retry
) {
    const std::string problem = task.problem.substr(0, std::min(problem_limit, task.problem.size()));
    const std::string response = answer.substr(0, std::min(answer_limit, answer.size()));
    std::ostringstream ss;
    ss << "You are an expert evaluator for the DRACO deep-research benchmark.\n"
       << "Grade every criterion independently against the system response.\n"
       << "Return only valid JSON; no markdown fences or commentary.\n\n"
       << "## Task query\n" << problem << "\n\n"
       << "## System response\n" << response << "\n\n"
       << "## Criteria\n" << criteria_for_prompt(criteria).dump(2) << "\n\n"
       << "## Rules\n"
       << "- verdict must be exactly MET or UNMET.\n"
       << "- Positive weight: MET means the requirement is satisfied.\n"
       << "- Negative weight: MET means the undesirable property is present and triggers a penalty.\n"
       << "- Judge only the response against the requirement; do not reward intentions or future work.\n"
       << "- Keep each justification to one sentence.\n"
       << "- Include one result for every criterion_id in the same order.\n\n"
       << "## Output schema\n"
       << "{\"results\":[{\"criterion_id\":\"...\",\"verdict\":\"MET|UNMET\","
          "\"justification\":\"...\"}]}\n";
    if (strict_retry) {
        ss << "CRITICAL RETRY: the previous answer was invalid or incomplete. Emit exactly the JSON object now.\n";
    }
    return ss.str();
}

struct ParsedJudgeBatch {
    std::unordered_map<std::string, std::string> verdicts;
    nlohmann::json items = nlohmann::json::array();
};

Result<ParsedJudgeBatch> parse_judge_batch(
    const std::string& text,
    const std::unordered_set<std::string>& expected_ids
) {
    auto object = extract_json_object(text);
    if (!object) return object.error();
    const auto& root = object.value();
    if (!root.is_object() || !root.contains("results") || !root["results"].is_array()) {
        return Error::parse_error("judge JSON missing results array", "results");
    }
    ParsedJudgeBatch parsed;
    for (const auto& item : root["results"]) {
        if (!item.is_object()) continue;
        const std::string id = item.value("criterion_id", item.value("id", std::string{}));
        const std::string verdict = normalize_verdict(item.value("verdict", std::string{}));
        if (id.empty() || verdict.empty() || expected_ids.count(id) == 0) continue;
        parsed.verdicts[id] = verdict;
        parsed.items.push_back({
            {"criterion_id", id},
            {"verdict", verdict},
            {"justification", item.value("justification", std::string{})},
        });
    }
    if (parsed.verdicts.empty()) {
        return Error::parse_error("judge JSON contained no valid expected verdicts");
    }
    return parsed;
}

void recalculate_batch(DracoBatchResult& batch) {
    batch.generated_tasks = 0;
    batch.judged_tasks = 0;
    batch.failed_tasks = 0;
    double score_sum = 0.0;
    std::size_t score_count = 0;
    for (const auto& task : batch.tasks) {
        if (task.answer_chars > 0) ++batch.generated_tasks;
        if (task.judged) {
            ++batch.judged_tasks;
            score_sum += task.score.normalized_score_pct;
            ++score_count;
        }
        if (!task.error.empty() || task.status == "judge_partial" || task.status == "generation_failed") {
            ++batch.failed_tasks;
        }
    }
    batch.mean_score_pct = score_count == 0 ? 0.0 : score_sum / static_cast<double>(score_count);
}

Result<void> persist_batch(const DracoBatchResult& batch, bool partial) {
    const auto json_path = batch.config.output_dir / (partial ? "summary_partial.json" : "summary.json");
    auto written = write_json_file(json_path, batch.to_json());
    if (!written) return written;
    if (batch.config.write_markdown) {
        auto md = write_text_file(batch.config.output_dir / "summary.md", batch.to_markdown());
        if (!md) return md;
    }
    return Result<void>::success();
}

}  // namespace

nlohmann::json DracoCriterion::to_json() const {
    return {
        {"id", id},
        {"section_id", section_id},
        {"section_title", section_title},
        {"requirement", requirement},
        {"weight", weight},
    };
}

nlohmann::json DracoTask::to_json() const {
    nlohmann::json criteria_json = nlohmann::json::array();
    for (const auto& criterion : criteria) criteria_json.push_back(criterion.to_json());
    return {
        {"index", index},
        {"id", id},
        {"domain", domain},
        {"problem", problem},
        {"rubric", rubric},
        {"criteria", std::move(criteria_json)},
    };
}

nlohmann::json DracoScore::to_json() const {
    return {
        {"raw_score", raw_score},
        {"positive_weight_sum", positive_weight_sum},
        {"normalized_score_pct", normalized_score_pct},
        {"n_criteria", n_criteria},
        {"n_judged", n_judged},
        {"n_missing", n_missing},
        {"met_positive", met_positive},
        {"unmet_positive", unmet_positive},
        {"met_negative_penalties", met_negative_penalties},
        {"unmet_negative", unmet_negative},
        {"details", details},
    };
}

nlohmann::json DracoRunConfig::to_json() const {
    return {
        {"dataset_path", dataset_path.string()},
        {"output_dir", output_dir.string()},
        {"provider", provider},
        {"model", model},
        {"judge_provider", judge_provider.empty() ? provider : judge_provider},
        {"judge_model", judge_model.empty() ? model : judge_model},
        {"tier", tier},
        {"offset", offset},
        {"limit", limit},
        {"resume", resume},
        {"generate_answers", generate_answers},
        {"judge_answers", judge_answers},
        {"enable_web_tools", enable_web_tools},
        {"parallel_branches", parallel_branches},
        {"max_parallel_branches", max_parallel_branches},
        {"answer_max_tokens", answer_max_tokens},
        {"judge_max_tokens", judge_max_tokens},
        {"judge_batch_size", judge_batch_size},
        {"generation_attempts", generation_attempts},
        {"judge_attempts", judge_attempts},
        {"judge_problem_max_chars", judge_problem_max_chars},
        {"judge_answer_max_chars", judge_answer_max_chars},
        {"protocol", "DRACO MET/UNMET weighted normalized score"},
    };
}

nlohmann::json DracoTaskResult::to_json() const {
    return {
        {"index", index},
        {"id", id},
        {"domain", domain},
        {"status", status},
        {"error", error},
        {"criteria_count", criteria_count},
        {"answer_chars", answer_chars},
        {"generation_calls", generation_calls},
        {"generation_wall_s", generation_wall_s},
        {"resumed_generation", resumed_generation},
        {"resumed_judge", resumed_judge},
        {"judged", judged},
        {"generation", generation},
        {"judge", judge},
        {"score", score.to_json()},
    };
}

nlohmann::json DracoBatchResult::to_json() const {
    nlohmann::json task_json = nlohmann::json::array();
    for (const auto& task : tasks) task_json.push_back(task.to_json());
    return {
        {"config", config.to_json()},
        {"dataset_tasks", dataset_tasks},
        {"selected_tasks", selected_tasks},
        {"generated_tasks", generated_tasks},
        {"judged_tasks", judged_tasks},
        {"failed_tasks", failed_tasks},
        {"mean_score_pct", mean_score_pct},
        {"tasks", std::move(task_json)},
    };
}

std::string DracoBatchResult::to_markdown() const {
    std::ostringstream ss;
    ss << "# DRACO native C++ batch\n\n"
       << "- tier: `" << config.tier << "`\n"
       << "- provider: `" << config.provider << "`\n"
       << "- model: `" << (config.model.empty() ? "provider-default" : config.model) << "`\n"
       << "- judge: `" << (config.judge_provider.empty() ? config.provider : config.judge_provider)
       << "/" << (config.judge_model.empty() ? config.model : config.judge_model) << "`\n"
       << "- range: " << config.offset << ".." << (config.offset + selected_tasks) << "\n"
       << "- generated: " << generated_tasks << "/" << selected_tasks << "\n"
       << "- fully judged: " << judged_tasks << "/" << selected_tasks << "\n"
       << "- failed or partial: " << failed_tasks << "\n"
       << "- mean normalized score: **" << std::fixed << std::setprecision(2)
       << mean_score_pct << "%**\n\n"
       << "| index | domain | status | calls | chars | score % | judged | missing |\n"
       << "|---:|---|---|---:|---:|---:|---:|---:|\n";
    for (const auto& task : tasks) {
        ss << "| " << task.index << " | " << task.domain << " | " << task.status << " | "
           << task.generation_calls << " | " << task.answer_chars << " | "
           << std::fixed << std::setprecision(2) << task.score.normalized_score_pct << " | "
           << task.score.n_judged << " | " << task.score.n_missing << " |\n";
    }
    return ss.str();
}

Result<std::vector<DracoTask>> load_draco_tasks(const std::filesystem::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return Error::invalid_argument("cannot read DRACO dataset: " + path.string());
    std::vector<DracoTask> tasks;
    std::string line;
    std::size_t line_number = 0;
    while (std::getline(in, line)) {
        ++line_number;
        if (trim_copy(line).empty()) continue;
        nlohmann::json row;
        try {
            row = nlohmann::json::parse(line);
        } catch (const std::exception& ex) {
            return Error::parse_error(
                "invalid DRACO JSONL line " + std::to_string(line_number) + ": " + ex.what()
            );
        }
        if (!row.is_object() || !row.contains("problem") || !row["problem"].is_string()) {
            return Error::parse_error(
                "DRACO line " + std::to_string(line_number) + " missing string problem"
            );
        }
        DracoTask task;
        task.index = tasks.size();
        task.id = row.value("id", "task-" + std::to_string(task.index));
        task.domain = row.value("domain", std::string{});
        task.problem = row["problem"].get<std::string>();
        try {
            if (row.contains("answer") && row["answer"].is_string()) {
                task.rubric = nlohmann::json::parse(row["answer"].get<std::string>());
            } else if (row.contains("answer") && row["answer"].is_object()) {
                task.rubric = row["answer"];
            } else {
                return Error::parse_error(
                    "DRACO line " + std::to_string(line_number) + " missing answer rubric"
                );
            }
        } catch (const std::exception& ex) {
            return Error::parse_error(
                "invalid rubric JSON at DRACO line " + std::to_string(line_number) + ": " + ex.what()
            );
        }
        std::size_t criterion_index = 0;
        const auto sections = task.rubric.value("sections", nlohmann::json::array());
        if (sections.is_array()) {
            for (const auto& section : sections) {
                if (!section.is_object()) continue;
                const std::string section_id = section.value("id", std::string{});
                const std::string section_title = section.value("title", std::string{});
                const auto criteria = section.value("criteria", nlohmann::json::array());
                if (!criteria.is_array()) continue;
                for (const auto& criterion_json : criteria) {
                    if (!criterion_json.is_object()) continue;
                    DracoCriterion criterion;
                    criterion.id = criterion_json.value(
                        "id", "criterion-" + std::to_string(criterion_index)
                    );
                    criterion.section_id = section_id;
                    criterion.section_title = section_title;
                    criterion.requirement = criterion_json.value("requirement", std::string{});
                    criterion.weight = criterion_json.value("weight", 0.0);
                    task.criteria.push_back(std::move(criterion));
                    ++criterion_index;
                }
            }
        }
        tasks.push_back(std::move(task));
    }
    if (tasks.empty()) return Error::parse_error("DRACO dataset contained no tasks");
    return tasks;
}

DracoScore score_draco_verdicts(
    const std::vector<DracoCriterion>& criteria,
    const std::unordered_map<std::string, std::string>& verdicts
) {
    DracoScore score;
    score.n_criteria = criteria.size();
    for (const auto& criterion : criteria) {
        if (criterion.weight > 0.0) score.positive_weight_sum += criterion.weight;
        const auto it = verdicts.find(criterion.id);
        const std::string verdict = it == verdicts.end() ? std::string{} : normalize_verdict(it->second);
        nlohmann::json detail = {
            {"id", criterion.id},
            {"section_id", criterion.section_id},
            {"weight", criterion.weight},
            {"verdict", verdict.empty() ? "MISSING" : verdict},
            {"contribution", 0.0},
        };
        if (verdict.empty()) {
            ++score.n_missing;
            score.details.push_back(std::move(detail));
            continue;
        }
        ++score.n_judged;
        const bool met = verdict == "MET";
        const double contribution = met ? criterion.weight : 0.0;
        score.raw_score += contribution;
        detail["contribution"] = contribution;
        if (criterion.weight > 0.0) {
            if (met) ++score.met_positive;
            else ++score.unmet_positive;
        } else {
            if (met) ++score.met_negative_penalties;
            else ++score.unmet_negative;
        }
        score.details.push_back(std::move(detail));
    }
    double normalized = 0.0;
    if (score.positive_weight_sum > 0.0) {
        normalized = std::clamp(score.raw_score / score.positive_weight_sum, 0.0, 1.0) * 100.0;
    }
    score.normalized_score_pct = std::round(normalized * 10000.0) / 10000.0;
    return score;
}

Result<DracoBatchResult> run_draco_batch(const DracoRunConfig& config) {
    if (config.dataset_path.empty()) {
        return Error::invalid_argument("DRACO dataset_path is required", "dataset_path");
    }
    if (config.limit == 0) return Error::invalid_argument("DRACO limit must be > 0", "limit");
    if (config.judge_batch_size <= 0) {
        return Error::invalid_argument("judge_batch_size must be > 0", "judge_batch_size");
    }
    const std::string tier = lower_copy(config.tier);
    const bool baseline = tier == "baseline" || tier == "solo";
    Result<FusionTier> fusion_tier = Error::invalid_argument("baseline has no fusion tier");
    if (!baseline) {
        fusion_tier = fusion_tier_from_string(tier);
        if (!fusion_tier) return fusion_tier.error();
    }

    auto loaded = load_draco_tasks(config.dataset_path);
    if (!loaded) return loaded.error();
    const auto& all_tasks = loaded.value();
    if (config.offset >= all_tasks.size()) {
        return Error::invalid_argument("offset is outside DRACO dataset", "offset");
    }
    const std::size_t end = std::min(all_tasks.size(), config.offset + config.limit);

    std::error_code ec;
    std::filesystem::create_directories(config.output_dir / "tasks", ec);
    if (ec) return Error::invalid_argument("cannot create output_dir: " + config.output_dir.string());

    DracoBatchResult batch;
    batch.config = config;
    batch.dataset_tasks = all_tasks.size();
    batch.selected_tasks = end - config.offset;

    auto dataset_text = read_text_file(config.dataset_path);
    const std::string dataset_hash = dataset_text
        ? fusion_sha256_hex(dataset_text.value())
        : std::string{};
    const auto manifest_path = config.output_dir / "manifest.json";
    if (config.resume && std::filesystem::is_regular_file(manifest_path)) {
        auto previous = read_json_file(manifest_path);
        if (!previous) return previous.error();
        const auto& prior = previous.value();
        if (prior.value("dataset_sha256", std::string{}) != dataset_hash) {
            return Error::invalid_argument(
                "resume refused: DRACO dataset content changed; use a new --out or --no-resume"
            );
        }
        const nlohmann::json current_config = config.to_json();
        const nlohmann::json prior_config = prior.value("config", nlohmann::json::object());
        const std::vector<std::string> frozen_keys = {
            "provider", "model", "judge_provider", "judge_model", "tier",
            "offset", "limit", "enable_web_tools", "parallel_branches",
            "max_parallel_branches", "answer_max_tokens", "judge_max_tokens",
            "judge_batch_size", "generation_attempts", "judge_attempts",
            "judge_problem_max_chars", "judge_answer_max_chars"
        };
        for (const auto& key : frozen_keys) {
            if (prior_config.value(key, nlohmann::json{}) !=
                current_config.value(key, nlohmann::json{})) {
                return Error::invalid_argument(
                    "resume refused: config field '" + key +
                    "' changed; use a new --out or --no-resume"
                );
            }
        }
    }
    nlohmann::json manifest = {
        {"benchmark", "draco-native-cpp-v1"},
        {"protocol", "DRACO MET/UNMET weighted normalized score"},
        {"dataset_path", config.dataset_path.string()},
        {"dataset_tasks", all_tasks.size()},
        {"dataset_sha256", dataset_hash},
        {"range", {{"offset", config.offset}, {"limit", config.limit}, {"end", end}}},
        {"config", config.to_json()},
        {"leaderboard_compatible", false},
        {"note", "Dataset and scoring protocol are DRACO-compatible; leaderboard identity also depends on the exact generation and judge models/runs."},
    };
    auto manifest_write = write_json_file(config.output_dir / "manifest.json", manifest);
    if (!manifest_write) return manifest_write.error();
    auto config_write = write_json_file(config.output_dir / "config.json", config.to_json());
    if (!config_write) return config_write.error();

    AnyProvider generation_provider;
    if (config.generate_answers) {
        ProviderResolveOptions options;
        options.model = config.model;
        auto provider = make_provider(config.provider, options);
        if (!provider) return provider.error();
        generation_provider = std::move(provider.value());
    }

    AnyProvider judge_provider;
    if (config.judge_answers) {
        ProviderResolveOptions options;
        options.model = config.judge_model.empty() ? config.model : config.judge_model;
        const std::string provider_name = config.judge_provider.empty() ? config.provider : config.judge_provider;
        auto provider = make_provider(provider_name, options);
        if (!provider) return provider.error();
        judge_provider = std::move(provider.value());
    }

    for (std::size_t i = config.offset; i < end; ++i) {
        const DracoTask& task = all_tasks[i];
        const auto task_dir = config.output_dir / "tasks" / task_dir_name(task.index, task.domain);
        std::filesystem::create_directories(task_dir, ec);
        if (ec) return Error::invalid_argument("cannot create task directory: " + task_dir.string());

        DracoTaskResult result;
        result.index = task.index;
        result.id = task.id;
        result.domain = task.domain;
        result.criteria_count = task.criteria.size();
        result.status = "pending";

        (void)write_text_file(task_dir / "problem.txt", task.problem);
        (void)write_json_file(task_dir / "meta.json", {
            {"index", task.index},
            {"id", task.id},
            {"domain", task.domain},
            {"problem_chars", task.problem.size()},
            {"criteria_count", task.criteria.size()},
        });

        const auto answer_path = task_dir / "answer.txt";
        const auto generation_path = task_dir / "generation.json";
        const auto judge_path = task_dir / "judge.json";
        const auto status_path = task_dir / "status.json";
        std::string answer;

        if (!config.resume) {
            std::filesystem::remove(answer_path, ec);
            ec.clear();
            std::filesystem::remove(generation_path, ec);
            ec.clear();
            std::filesystem::remove(judge_path, ec);
            ec.clear();
            std::filesystem::remove(status_path, ec);
            ec.clear();
        }

        if (config.resume && std::filesystem::is_regular_file(answer_path)) {
            auto previous = read_text_file(answer_path);
            if (previous && !trim_copy(previous.value()).empty()) {
                answer = std::move(previous.value());
                result.resumed_generation = true;
                if (auto generation_json = read_json_file(generation_path)) {
                    result.generation = generation_json.value();
                    result.generation_calls = result.generation.value("llm_calls", 0);
                    result.generation_wall_s = result.generation.value("wall_s", 0.0);
                }
            }
        }

        if (answer.empty() && config.generate_answers) {
            const auto start = Clock::now();
            nlohmann::json attempts = nlohmann::json::array();
            const int max_attempts = std::max(1, config.generation_attempts);
            for (int attempt = 1; attempt <= max_attempts; ++attempt) {
                std::string prompt = research_prompt(task.problem);
                if (attempt > 1) {
                    prompt +=
                        "\nCRITICAL RETRY: the previous draft was incomplete. Write the substantive final report now.";
                }
                if (baseline) {
                    GenerateOptions options;
                    options.agent_name = "draco_baseline";
                    options.task = task.problem;
                    options.max_tokens = config.answer_max_tokens;
                    auto generated = generation_provider.generate(prompt, options);
                    ++result.generation_calls;
                    if (generated) answer = generated.value();
                    attempts.push_back({
                        {"attempt", attempt},
                        {"success", static_cast<bool>(generated)},
                        {"chars", answer.size()},
                        {"error", generated ? std::string{} : generated.error().message},
                        {"usage", generation_provider.last_usage().to_json()},
                    });
                    if (!generated && attempt == max_attempts) result.error = generated.error().message;
                } else {
                    FusionConfig fusion_config;
                    apply_fusion_tier(fusion_config, fusion_tier.value());
                    fusion_config.task = prompt;
                    fusion_config.profile = FusionProfileId::Research;
                    fusion_config.provider = config.provider;
                    fusion_config.model = config.model;
                    fusion_config.write_files = false;
                    fusion_config.cache.enabled = false;
                    fusion_config.enable_web_tools = config.enable_web_tools;
                    fusion_config.parallel_branches = config.parallel_branches;
                    fusion_config.max_parallel_branches = std::clamp(config.max_parallel_branches, 1, 8);
                    FusionEngine engine;
                    auto generated = engine.run_with_provider(fusion_config, generation_provider);
                    if (generated) {
                        answer = generated.value().final_output;
                        result.generation_calls += generated.value().metrics.llm_calls;
                        attempts.push_back({
                            {"attempt", attempt},
                            {"success", generated.value().success},
                            {"chars", answer.size()},
                            {"error", generated.value().error},
                            {"metrics", generated.value().metrics.to_json()},
                            {"run_id", generated.value().run_id},
                        });
                        if (!generated.value().success && result.error.empty()) {
                            result.error = generated.value().error;
                        }
                    } else {
                        attempts.push_back({
                            {"attempt", attempt},
                            {"success", false},
                            {"chars", 0},
                            {"error", generated.error().message},
                        });
                        if (attempt == max_attempts) result.error = generated.error().message;
                    }
                }
                if (!answer.empty() && !looks_like_stub(answer)) {
                    result.error.clear();
                    break;
                }
            }
            result.generation_wall_s = std::chrono::duration<double>(Clock::now() - start).count();
            result.generation = {
                {"tier", baseline ? "baseline" : tier},
                {"provider", config.provider},
                {"model", config.model},
                {"llm_calls", result.generation_calls},
                {"wall_s", result.generation_wall_s},
                {"chars", answer.size()},
                {"stub_like", looks_like_stub(answer)},
                {"attempts", std::move(attempts)},
            };
            if (!answer.empty()) (void)write_text_file(answer_path, answer);
            (void)write_json_file(generation_path, result.generation);
        }

        result.answer_chars = answer.size();
        if (answer.empty()) {
            result.status = "generation_failed";
            if (result.error.empty()) {
                result.error = config.generate_answers
                    ? "generation produced an empty answer"
                    : "answer.txt is missing for judge-only run";
            }
            result.score.n_criteria = task.criteria.size();
            result.score.n_missing = task.criteria.size();
            (void)write_json_file(status_path, result.to_json());
            batch.tasks.push_back(std::move(result));
            recalculate_batch(batch);
            (void)persist_batch(batch, true);
            continue;
        }

        result.status = config.judge_answers ? "generated" : "complete_unjudged";
        if (!config.judge_answers) {
            (void)write_json_file(status_path, result.to_json());
            batch.tasks.push_back(std::move(result));
            recalculate_batch(batch);
            (void)persist_batch(batch, true);
            continue;
        }

        std::unordered_map<std::string, std::string> verdicts;
        nlohmann::json judge_items = nlohmann::json::array();
        nlohmann::json judge_errors = nlohmann::json::array();
        bool existing_complete = false;
        if (config.resume && std::filesystem::is_regular_file(judge_path)) {
            auto previous = read_json_file(judge_path);
            if (previous && previous.value().is_object()) {
                const auto& root = previous.value();
                if (root.contains("verdicts") && root["verdicts"].is_object()) {
                    for (auto it = root["verdicts"].begin(); it != root["verdicts"].end(); ++it) {
                        if (it.value().is_string()) {
                            const std::string normalized = normalize_verdict(it.value().get<std::string>());
                            if (!normalized.empty()) verdicts[it.key()] = normalized;
                        }
                    }
                }
                judge_items = root.value("items", nlohmann::json::array());
                judge_errors = root.value("errors", nlohmann::json::array());
                existing_complete = !root.value("partial", true) && root.contains("score");
                if (existing_complete) {
                    result.resumed_judge = true;
                    result.judge = root;
                    result.score = score_from_json(root["score"]);
                    result.judged = result.score.n_missing == 0;
                    result.status = result.judged ? "complete" : "judge_partial";
                }
            }
        }

        if (!existing_complete) {
            for (std::size_t begin = 0; begin < task.criteria.size(); begin += static_cast<std::size_t>(config.judge_batch_size)) {
                std::vector<const DracoCriterion*> pending;
                const std::size_t batch_end = std::min(
                    task.criteria.size(), begin + static_cast<std::size_t>(config.judge_batch_size)
                );
                for (std::size_t ci = begin; ci < batch_end; ++ci) {
                    if (verdicts.count(task.criteria[ci].id) == 0) pending.push_back(&task.criteria[ci]);
                }
                if (pending.empty()) continue;

                std::unordered_set<std::string> expected;
                for (const auto* criterion : pending) expected.insert(criterion->id);
                bool any_success = false;
                const int attempts = std::max(1, config.judge_attempts);
                for (int attempt = 1; attempt <= attempts && !expected.empty(); ++attempt) {
                    std::vector<const DracoCriterion*> retry_pending;
                    for (const auto* criterion : pending) {
                        if (expected.count(criterion->id) != 0) retry_pending.push_back(criterion);
                    }
                    const std::string prompt = judge_prompt(
                        task,
                        answer,
                        retry_pending,
                        config.judge_problem_max_chars,
                        config.judge_answer_max_chars,
                        attempt > 1
                    );
                    GenerateOptions options;
                    options.agent_name = "draco_judge";
                    options.task = "Grade DRACO criteria";
                    options.max_tokens = config.judge_max_tokens;
                    options.temperature = 0.0;
                    // DRACO judging requires compact JSON, not a long hidden reasoning trace.
                    // Disable provider thinking when supported so the final verdicts fit the budget.
                    options.extra_body["thinking"] = {{"type", "disabled"}};
                    auto judged = judge_provider.generate(prompt, options);
                    if (!judged) {
                        judge_errors.push_back({
                            {"batch_begin", begin},
                            {"attempt", attempt},
                            {"error", judged.error().message},
                        });
                        continue;
                    }
                    auto parsed = parse_judge_batch(judged.value(), expected);
                    if (!parsed) {
                        judge_errors.push_back({
                            {"batch_begin", begin},
                            {"attempt", attempt},
                            {"error", parsed.error().message},
                            {"raw_preview", judged.value().substr(0, 500)},
                        });
                        continue;
                    }
                    any_success = true;
                    for (const auto& [id, verdict] : parsed.value().verdicts) {
                        verdicts[id] = verdict;
                        expected.erase(id);
                    }
                    for (const auto& item : parsed.value().items) judge_items.push_back(item);
                }
                if (!any_success && !expected.empty()) {
                    judge_errors.push_back({
                        {"batch_begin", begin},
                        {"error", "no valid judge verdicts after retries"},
                        {"missing_ids", std::vector<std::string>(expected.begin(), expected.end())},
                    });
                }
                const DracoScore partial_score = score_draco_verdicts(task.criteria, verdicts);
                nlohmann::json verdict_json = nlohmann::json::object();
                for (const auto& [id, verdict] : verdicts) verdict_json[id] = verdict;
                (void)write_json_file(judge_path, {
                    {"partial", partial_score.n_missing > 0},
                    {"verdicts", verdict_json},
                    {"items", judge_items},
                    {"errors", judge_errors},
                    {"score", partial_score.to_json()},
                    {"judge_provider", config.judge_provider.empty() ? config.provider : config.judge_provider},
                    {"judge_model", config.judge_model.empty() ? config.model : config.judge_model},
                });
            }

            result.score = score_draco_verdicts(task.criteria, verdicts);
            result.judged = result.score.n_missing == 0;
            result.status = result.judged ? "complete" : "judge_partial";
            nlohmann::json verdict_json = nlohmann::json::object();
            for (const auto& [id, verdict] : verdicts) verdict_json[id] = verdict;
            result.judge = {
                {"partial", !result.judged},
                {"verdicts", verdict_json},
                {"items", judge_items},
                {"errors", judge_errors},
                {"score", result.score.to_json()},
                {"judge_provider", config.judge_provider.empty() ? config.provider : config.judge_provider},
                {"judge_model", config.judge_model.empty() ? config.model : config.judge_model},
            };
            (void)write_json_file(judge_path, result.judge);
            if (!result.judged && result.error.empty()) {
                result.error = "judge left " + std::to_string(result.score.n_missing) + " criteria missing";
            }
        }

        (void)write_json_file(status_path, result.to_json());
        batch.tasks.push_back(std::move(result));
        recalculate_batch(batch);
        auto partial_write = persist_batch(batch, true);
        if (!partial_write) return partial_write.error();
    }

    recalculate_batch(batch);
    auto final_write = persist_batch(batch, false);
    if (!final_write) return final_write.error();
    return batch;
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
