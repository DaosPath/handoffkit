#include <handoffkit/demos/fusion/war_room.hpp>
#include <handoffkit/demos/fusion/engine.hpp>

#include <chrono>
#include <sstream>

namespace handoffkit {
namespace demos {
namespace fusion {
namespace {

std::string preview_of(std::string_view s, std::size_t n) {
    if (s.size() <= n) return std::string(s);
    std::string out(s.substr(0, n));
    out += "...";
    return out;
}

std::string one_line(std::string s) {
    for (char& c : s) {
        if (c == '\n' || c == '\r' || c == '|') c = ' ';
    }
    return s;
}

}  // namespace

nlohmann::json WarRoomTierRow::to_json() const {
    return nlohmann::json{
        {"tier", tier},
        {"success", success},
        {"llm_calls", llm_calls},
        {"planned_calls", planned_calls},
        {"wall_ms", wall_ms},
        {"handoff_count", handoff_count},
        {"answer_chars", answer_chars},
        {"mode", mode},
        {"pack_id", pack_id},
        {"error", error},
        {"preview", preview},
        {"panel_judge_success", panel_judge_success},
        {"consensus_n", consensus_n},
        {"contradictions_n", contradictions_n},
        {"analysis_preview", analysis_preview},
    };
}

nlohmann::json WarRoomReport::to_json() const {
    nlohmann::json arr = nlohmann::json::array();
    for (const auto& r : rows) arr.push_back(r.to_json());
    return nlohmann::json{
        {"task", task},
        {"provider", provider},
        {"profile", profile},
        {"total_wall_ms", total_wall_ms},
        {"tiers", std::move(arr)},
    };
}

std::string WarRoomReport::to_markdown() const {
    std::ostringstream ss;
    ss << "# Fusion War Room\n\n"
       << "provider=`" << provider << "` profile=`" << profile << "` "
       << "total_wall_ms=" << total_wall_ms << "\n\n"
       << "task: " << task << "\n\n"
       << "| tier | ok | calls | planned | wall_ms | handoffs | chars | judge | cons | contra | pack | preview |\n"
       << "|------|:--:|------:|--------:|--------:|---------:|------:|:-----:|-----:|-------:|------|---------|\n";
    for (const auto& r : rows) {
        ss << "| " << r.tier
           << " | " << (r.success ? "Y" : "N")
           << " | " << r.llm_calls
           << " | " << r.planned_calls
           << " | " << r.wall_ms
           << " | " << r.handoff_count
           << " | " << r.answer_chars
           << " | " << (r.panel_judge_success ? "Y" : "N")
           << " | " << r.consensus_n
           << " | " << r.contradictions_n
           << " | " << r.pack_id
           << " | " << one_line(r.preview)
           << " |\n";
    }
    ss << "\n";
    for (const auto& r : rows) {
        ss << "## " << r.tier << "\n\n";
        if (!r.success) {
            ss << "ERROR: " << r.error << "\n\n";
            continue;
        }
        if (!r.analysis_preview.empty()) {
            ss << "analysis: " << r.analysis_preview << "\n\n";
        }
        ss << r.answer << "\n\n";
    }
    return ss.str();
}

Result<WarRoomReport> run_fusion_war_room(const WarRoomOptions& opts) {
    if (opts.task.empty()) {
        return Error::invalid_argument("war room task is empty", "task");
    }
    if (opts.tiers.empty()) {
        return Error::invalid_argument("war room tiers empty", "tiers");
    }

    WarRoomReport rep;
    rep.task = opts.task;
    rep.provider = opts.provider;
    rep.profile = fusion_profile_to_string(opts.profile);

    const auto t_all0 = std::chrono::steady_clock::now();

    for (const auto& tier_name : opts.tiers) {
        WarRoomTierRow row;
        row.tier = tier_name;

        auto tr = fusion_tier_from_string(tier_name);
        if (!tr) {
            row.success = false;
            row.error = tr.error().message;
            rep.rows.push_back(std::move(row));
            continue;
        }

        FusionConfig cfg;
        cfg.task = opts.task;
        cfg.provider = opts.provider;
        cfg.model = opts.model;
        cfg.profile = opts.profile;
        cfg.write_files = opts.write_files;
        cfg.cache.enabled = opts.cache_enabled;
        cfg.cache.use_disk = false;
        cfg.enable_web_tools = false;
        cfg.attach_panel_judge = true;
        apply_fusion_tier(cfg, tr.value());
        row.planned_calls = planned_llm_calls_for_config(cfg);
        row.mode = fusion_mode_to_string(cfg.mode);
        row.pack_id = fusion_capability_pack(cfg.tier).pack_id;

        const auto t0 = std::chrono::steady_clock::now();
        auto run = run_fusion(cfg);
        const auto t1 = std::chrono::steady_clock::now();
        row.wall_ms = static_cast<int>(
            std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count()
        );

        if (!run) {
            row.success = false;
            row.error = run.error().message;
            rep.rows.push_back(std::move(row));
            continue;
        }
        const auto& r = run.value();
        row.success = r.success;
        row.llm_calls = r.metrics.llm_calls;
        row.handoff_count = r.metrics.handoff_count;
        row.answer = r.final_output;
        row.answer_chars = r.final_output.size();
        row.preview = preview_of(r.final_output, opts.preview_chars);
        if (!r.success) row.error = r.error;
        if (r.report.contains("capability") && r.report["capability"].contains("pack_id")) {
            row.pack_id = r.report["capability"].value("pack_id", row.pack_id);
        }
        // Prefer unified report.analysis; fall back to panel_judge.analysis nesting.
        const nlohmann::json* analysis = nullptr;
        if (r.report.contains("analysis") && r.report["analysis"].is_object()) {
            analysis = &r.report["analysis"];
            row.panel_judge_success = true;
        }
        if (r.report.contains("panel_judge") && r.report["panel_judge"].is_object()) {
            const auto& pj = r.report["panel_judge"];
            row.panel_judge_success = pj.value("success", row.panel_judge_success);
            if (!analysis && pj.contains("analysis") && pj["analysis"].is_object()) {
                analysis = &pj["analysis"];
            }
            if (row.analysis_preview.empty() && pj.contains("final_answer") &&
                pj["final_answer"].is_string()) {
                row.analysis_preview = preview_of(pj["final_answer"].get<std::string>(), 160);
            }
        }
        if (analysis) {
            row.consensus_n =
                static_cast<int>(analysis->value("consensus", nlohmann::json::array()).size());
            row.contradictions_n =
                static_cast<int>(analysis->value("contradictions", nlohmann::json::array()).size());
            if (row.analysis_preview.empty() && analysis->contains("final_answer") &&
                (*analysis)["final_answer"].is_string()) {
                row.analysis_preview =
                    preview_of((*analysis)["final_answer"].get<std::string>(), 160);
            }
        }
        rep.rows.push_back(std::move(row));
    }

    const auto t_all1 = std::chrono::steady_clock::now();
    rep.total_wall_ms = static_cast<int>(
        std::chrono::duration_cast<std::chrono::milliseconds>(t_all1 - t_all0).count()
    );
    // fix profile field in json path
    rep.profile = fusion_profile_to_string(opts.profile);
    return rep;
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
