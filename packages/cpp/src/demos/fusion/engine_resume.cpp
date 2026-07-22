#include <handoffkit/demos/fusion/engine_resume.hpp>
#include <handoffkit/demos/fusion/engine_internal.hpp>
#include <handoffkit/demos/fusion/hash.hpp>
#include <handoffkit/demos/fusion/merge_strategy.hpp>
#include <handoffkit/demos/fusion/prompt.hpp>
#include <handoffkit/demos/fusion/provider_wrap.hpp>
#include <handoffkit/demos/fusion/roles.hpp>

#include <fstream>

namespace handoffkit {
namespace demos {
namespace fusion {

nlohmann::json FusionStepRecord::to_json() const {
    return nlohmann::json{
        {"step_id", step_id},
        {"role_id", role_id},
        {"prompt_hash", prompt_hash},
        {"output", output},
        {"from_cache", from_cache},
        {"latency_ms", latency_ms},
    };
}

Result<FusionStepRecord> FusionStepRecord::from_json(const nlohmann::json& j) {
    if (!j.is_object()) return Result<FusionStepRecord>::failure(Error::parse_error("step not object"));
    FusionStepRecord s;
    s.step_id = j.value("step_id", "");
    s.role_id = j.value("role_id", "");
    s.prompt_hash = j.value("prompt_hash", "");
    s.output = j.value("output", "");
    s.from_cache = j.value("from_cache", false);
    s.latency_ms = j.value("latency_ms", 0);
    if (s.step_id.empty()) return Result<FusionStepRecord>::failure(Error::parse_error("step_id required"));
    return s;
}

nlohmann::json FusionCheckpoint::to_json() const {
    nlohmann::json arr = nlohmann::json::array();
    for (const auto& s : steps) arr.push_back(s.to_json());
    return nlohmann::json{
        {"run_id", run_id},
        {"config", config.to_json()},
        {"steps", std::move(arr)},
        {"complete", complete},
    };
}

Result<FusionCheckpoint> FusionCheckpoint::from_json(const nlohmann::json& j) {
    if (!j.is_object()) return Result<FusionCheckpoint>::failure(Error::parse_error("checkpoint not object"));
    FusionCheckpoint cp;
    cp.run_id = j.value("run_id", "");
    cp.complete = j.value("complete", false);
    if (j.contains("config")) {
        auto c = FusionConfig::from_json(j.at("config"));
        if (!c) return Result<FusionCheckpoint>::failure(c.error());
        cp.config = c.value();
    }
    if (j.contains("steps") && j.at("steps").is_array()) {
        for (const auto& item : j.at("steps")) {
            auto s = FusionStepRecord::from_json(item);
            if (!s) return Result<FusionCheckpoint>::failure(s.error());
            cp.steps.push_back(std::move(s.value()));
        }
    }
    return cp;
}

Result<void> write_checkpoint(const std::filesystem::path& path, const FusionCheckpoint& cp) {
    std::error_code ec;
    if (path.has_parent_path()) std::filesystem::create_directories(path.parent_path(), ec);
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out) return Result<void>::failure(Error::provider_failed("cannot write checkpoint"));
    out << cp.to_json().dump(2);
    return Result<void>::success();
}

Result<FusionCheckpoint> load_checkpoint(const std::filesystem::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return Result<FusionCheckpoint>::failure(Error::parse_error("cannot open checkpoint"));
    std::string body((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    try {
        return FusionCheckpoint::from_json(nlohmann::json::parse(body));
    } catch (const std::exception& ex) {
        return Result<FusionCheckpoint>::failure(Error::parse_error(std::string("checkpoint: ") + ex.what()));
    }
}

const FusionStepRecord* find_step(const FusionCheckpoint& cp, std::string_view step_id) {
    for (const auto& s : cp.steps) {
        if (s.step_id == step_id) return &s;
    }
    return nullptr;
}

FusionCheckpoint checkpoint_from_run(const FusionRunResult& run) {
    FusionCheckpoint cp;
    cp.run_id = run.run_id;
    cp.config = run.config;
    cp.complete = run.success;
    for (const auto& c : run.metrics.calls) {
        FusionStepRecord s;
        s.step_id = c.step_id;
        s.role_id = c.role_id;
        s.prompt_hash = c.prompt_hash;
        s.from_cache = c.cache_hit;
        s.latency_ms = c.latency_ms;
        // recover outputs from branches/merge when possible
        if (c.step_id.find("branch_a") != std::string::npos && !run.branches.empty()) {
            s.output = c.step_id.find("skeptic") != std::string::npos
                ? run.branches[0].skeptic_output
                : run.branches[0].architect_output;
        } else if (c.step_id.find("branch_b") != std::string::npos && run.branches.size() > 1) {
            s.output = c.step_id.find("skeptic") != std::string::npos
                ? run.branches[1].skeptic_output
                : run.branches[1].architect_output;
        } else if (c.step_id.find("merge") != std::string::npos) {
            s.output = run.merge_output;
        }
        cp.steps.push_back(std::move(s));
    }
    return cp;
}

Result<FusionRunResult> resume_merge_only(
    const FusionCheckpoint& cp,
    std::shared_ptr<FusionCache> cache
) {
    const auto* a = find_step(cp, "branch_a_architect");
    const auto* b = find_step(cp, "branch_b_architect");
    // also accept dag names
    if (!a || !b || a->output.empty() || b->output.empty()) {
        return Error::invalid_argument("checkpoint missing branch architect outputs", "checkpoint");
    }

    FusionConfig cfg = cp.config;
    cfg.write_files = false;
    auto pack_result = detail::resolve_role_pack(cfg);
    if (!pack_result) return pack_result.error();
    auto pack = std::move(pack_result.value());
    auto plan = merge_plan_for_pack(pack);
    std::vector<std::pair<std::string, std::string>> labeled = {
        {pack.branches[0].label, a->output},
        {pack.branches[1].label, b->output},
    };
    // include skeptics if present
    if (const auto* sa = find_step(cp, "branch_a_skeptic"); sa && !sa->output.empty()) {
        labeled[0].second += "\n\n[Skeptic A]\n" + sa->output;
    }
    if (const auto* sb = find_step(cp, "branch_b_skeptic"); sb && !sb->output.empty()) {
        labeled[1].second += "\n\n[Skeptic B]\n" + sb->output;
    }

    auto merge_user = build_merge_user_prompt(cfg.task, labeled, plan, pack);
    auto provider = make_fusion_provider(cfg, cache);
    if (!provider) return provider.error();

    GenerateOptions opt;
    opt.agent_name = pack.merger.agent_name;
    opt.task = cfg.task;
    opt.max_tokens = cfg.generation.merge_max_tokens;
    opt.temperature = cfg.generation.temperature;
    opt.top_p = cfg.generation.top_p;
    opt.extra_body = cfg.generation.extra_body;
    const std::string full = "Role: " + pack.merger.system_role + "\nTask: " + merge_user + "\n";
    const auto t0 = fusion_now_unix_ms();
    auto out = provider.value().generate(full, opt);
    const auto t1 = fusion_now_unix_ms();
    if (!out) return out.error();

    FusionRunResult run;
    run.run_id = cp.run_id.empty() ? make_fusion_run_id() : cp.run_id;
    run.config = cfg;
    run.success = !out.value().empty();
    run.merge_output = out.value();
    run.final_output = out.value();
    FusionBranchOutput ba, bb;
    ba.branch_id = "a";
    ba.label = pack.branches[0].label;
    ba.architect_output = a->output;
    ba.combined = labeled[0].second;
    bb.branch_id = "b";
    bb.label = pack.branches[1].label;
    bb.architect_output = b->output;
    bb.combined = labeled[1].second;
    run.branches = {std::move(ba), std::move(bb)};
    FusionCallRecord rec;
    rec.step_id = "merge_resume";
    rec.role_id = pack.merger.role_id;
    rec.agent_name = pack.merger.agent_name;
    rec.latency_ms = static_cast<int>(t1 - t0);
    rec.chars_in = full.size();
    rec.chars_out = out.value().size();
    rec.prompt_hash = fusion_content_hash(full);
    run.metrics.calls.push_back(rec);
    run.metrics.llm_calls = 1;
    run.metrics.wall_ms = rec.latency_ms;
    if (cache) run.metrics.cache = cache->stats();
    run.report = {
        {"resumed", true},
        {"merge_only", true},
        {"run_id", run.run_id},
        {"llm_calls", 1},
    };
    return run;
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
