#include <handoffkit/demos/fusion/panel.hpp>
#include <handoffkit/demos/fusion/algo_rubric.hpp>
#include <handoffkit/demos/fusion/prompt.hpp>

#include <algorithm>
#include <cctype>
#include <sstream>
#include <unordered_set>

namespace handoffkit {
namespace demos {
namespace fusion {
namespace {

std::vector<std::string> tokens(std::string_view text) {
    std::vector<std::string> out;
    std::string cur;
    for (char ch : text) {
        if (std::isalnum(static_cast<unsigned char>(ch))) {
            cur.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(ch))));
        } else if (!cur.empty()) {
            if (cur.size() >= 4) out.push_back(cur);
            cur.clear();
        }
    }
    if (cur.size() >= 4) out.push_back(cur);
    return out;
}

double jaccard(const std::vector<std::string>& a, const std::vector<std::string>& b) {
    if (a.empty() || b.empty()) return 0.0;
    std::unordered_set<std::string> sa(a.begin(), a.end());
    std::unordered_set<std::string> sb(b.begin(), b.end());
    std::size_t inter = 0;
    for (const auto& t : sa) {
        if (sb.count(t)) ++inter;
    }
    const std::size_t uni = sa.size() + sb.size() - inter;
    return uni ? static_cast<double>(inter) / static_cast<double>(uni) : 0.0;
}

std::string first_sentence(std::string_view text, std::size_t max_chars = 220) {
    std::string s(text);
    while (!s.empty() && (s.front() == ' ' || s.front() == '\n' || s.front() == '\r')) {
        s.erase(s.begin());
    }
    auto cut = s.find(". ");
    if (cut != std::string::npos && cut + 1 < max_chars) return s.substr(0, cut + 1);
    auto nl = s.find('\n');
    if (nl != std::string::npos && nl > 8 && nl < max_chars) return s.substr(0, nl);
    if (s.size() > max_chars) return s.substr(0, max_chars) + "...";
    return s;
}

bool looks_like_direct_answer(std::string_view lead) {
    if (lead.size() < 8) return false;
    const std::string l(lead);
    // Echo prompts / meta process talk are not direct answers
    if (l.find("ORIGINAL TASK") != std::string::npos) return false;
    if (l.find("Role:") == 0 || l.find("You are") == 0) return false;
    if (l.find("Skills to apply") != std::string::npos) return false;
    return true;
}

}  // namespace

nlohmann::json PanelSlot::to_json() const {
    return nlohmann::json{
        {"provider", provider},
        {"model", model},
        {"role", role},
        {"answer", answer},
        {"strengths", strengths},
        {"risks", risks},
        {"confidence", confidence},
        {"error", error},
    };
}

nlohmann::json PanelJudgeReport::analysis_json() const {
    return nlohmann::json{
        {"consensus", consensus},
        {"contradictions", contradictions},
        {"coverage_gaps", coverage_gaps},
        {"unique_insights", unique_insights},
        {"blind_spots", blind_spots},
        {"final_answer", final_answer},
        {"rubric", rubric},
        {"meta_judge_used", meta_judge_used},
    };
}

nlohmann::json PanelJudgeReport::to_json() const {
    nlohmann::json arr = nlohmann::json::array();
    for (const auto& s : panel) arr.push_back(s.to_json());
    return nlohmann::json{
        {"success", success},
        {"task", task},
        {"mode", mode},
        {"panel", std::move(arr)},
        {"analysis", analysis_json()},
        {"final_answer", final_answer},
        {"rubric", rubric},
        {"meta_judge_used", meta_judge_used},
    };
}

std::string PanelJudgeReport::to_markdown() const {
    std::ostringstream ss;
    ss << "# Fusion panel judge\n\n"
       << "mode=`" << mode << "` success=" << (success ? "true" : "false") << "\n\n"
       << "## Task\n\n" << task << "\n\n"
       << "## Panel\n\n"
       << "| model | role | confidence | answer (excerpt) |\n"
       << "|-------|------|------------|------------------|\n";
    for (const auto& s : panel) {
        std::string ex = first_sentence(s.answer, 120);
        for (char& c : ex) {
            if (c == '|' || c == '\n') c = ' ';
        }
        ss << "| " << s.model << " | " << s.role << " | " << s.confidence << " | " << ex << " |\n";
    }
    ss << "\n## Consensus\n";
    for (const auto& c : consensus) ss << "- " << c << "\n";
    ss << "\n## Contradictions\n";
    if (contradictions.empty()) ss << "- none detected by overlap heuristic\n";
    for (const auto& c : contradictions) ss << "- " << c << "\n";
    ss << "\n## Coverage gaps\n";
    for (const auto& c : coverage_gaps) ss << "- " << c << "\n";
    ss << "\n## Unique insights\n";
    for (const auto& c : unique_insights) ss << "- " << c << "\n";
    ss << "\n## Blind spots\n";
    for (const auto& c : blind_spots) ss << "- " << c << "\n";
    ss << "\n## Final answer\n\n" << final_answer << "\n";
    return ss.str();
}

std::string PanelJudgeReport::merge_prompt_section() const {
    std::ostringstream ss;
    ss << "### Pre-merge panel analysis (use this; do not ignore)\n"
       << "Consensus:\n";
    for (const auto& c : consensus) ss << "- " << c << "\n";
    ss << "Contradictions:\n";
    if (contradictions.empty()) ss << "- none flagged\n";
    for (const auto& c : contradictions) ss << "- " << c << "\n";
    ss << "Coverage gaps:\n";
    for (const auto& c : coverage_gaps) ss << "- " << c << "\n";
    ss << "Unique insights:\n";
    for (const auto& c : unique_insights) ss << "- " << c << "\n";
    ss << "Blind spots:\n";
    for (const auto& c : blind_spots) ss << "- " << c << "\n";
    if (!final_answer.empty()) {
        ss << "Analysis draft final (prefer improving, not discarding concrete claims):\n"
           << final_answer << "\n";
    }
    return ss.str();
}

std::vector<std::string> default_panel_roles() {
    return panel_roles_for_profile(FusionProfileId::Research);
}

std::vector<std::string> panel_roles_for_profile(FusionProfileId profile) {
    switch (profile) {
        case FusionProfileId::Coding:
            return {
                "implementer",
                "test strategist",
                "security reviewer",
                "api architect",
            };
        case FusionProfileId::Shipping:
            return {
                "library-first advocate",
                "cli-first advocate",
                "release risk owner",
                "operator UX reviewer",
            };
        case FusionProfileId::Diagnostic:
            return {
                "broad diagnostician",
                "mechanism checker",
                "adversarial reviewer",
                "workup planner",
            };
        case FusionProfileId::Dialectic:
            return {
                "thesis advocate",
                "antithesis advocate",
                "evidence auditor",
                "synthesis lead",
            };
        case FusionProfileId::Research:
        case FusionProfileId::Neutral:
        default:
            return {
                "broad diagnostician",
                "mechanism checker",
                "adversarial reviewer",
                "retrieval planner",
            };
    }
}

PanelModelSpec parse_panel_model_spec(std::string_view spec) {
    PanelModelSpec out;
    const auto pos = spec.find(':');
    // provider:model only when left side looks like a provider name (no spaces, short)
    if (pos != std::string_view::npos && pos > 0 && pos < spec.size() - 1) {
        const auto left = spec.substr(0, pos);
        const auto right = spec.substr(pos + 1);
        bool left_ok = !left.empty() && left.find(' ') == std::string_view::npos && left.size() < 32;
        // Avoid treating "gpt-4:preview" style as provider if left has digits only models —
        // require left to be known-ish alphanumeric with optional dash
        if (left_ok && left.find('/') == std::string_view::npos) {
            // Heuristic: if left is openai|openrouter|grok|nvidia|echo|ollama|opencode|groq|anthropic|z-ai
            // or contains no '/', treat as provider:model when left is all lowercase-ish letters
            bool has_alpha = false;
            for (char c : left) {
                if (std::isalpha(static_cast<unsigned char>(c))) has_alpha = true;
            }
            if (has_alpha && right.find(':') == std::string_view::npos) {
                // Common case openrouter/meta/... uses slash not second colon
                out.provider = std::string(left);
                out.model = std::string(right);
                return out;
            }
        }
    }
    out.model = std::string(spec);
    return out;
}

std::vector<std::string> resolve_panel_models(const FusionConfig& config) {
    auto specs = resolve_panel_model_specs(config);
    std::vector<std::string> out;
    for (const auto& s : specs) {
        if (!s.provider.empty()) out.push_back(s.provider + ":" + s.model);
        else out.push_back(s.model);
    }
    return out;
}

std::vector<PanelModelSpec> resolve_panel_model_specs(const FusionConfig& config) {
    std::vector<PanelModelSpec> out;
    auto push_raw = [&](const std::string& m) {
        if (m.empty()) return;
        auto spec = parse_panel_model_spec(m);
        // de-dupe exact provider+model
        for (const auto& e : out) {
            if (e.provider == spec.provider && e.model == spec.model) return;
        }
        out.push_back(std::move(spec));
    };
    if (!config.panel_models.empty()) {
        for (const auto& m : config.panel_models) push_raw(m);
    } else {
        push_raw(config.model_a);
        push_raw(config.model_b);
        push_raw(config.model);
        push_raw(config.model_merge);
    }
    if (out.empty()) {
        PanelModelSpec d;
        d.model = config.model.empty() ? std::string("(provider-default)") : config.model;
        out = {d, d, d, d};
    }
    while (out.size() < 2) out.push_back(out.back());
    return out;
}

std::string frame_panel_role_task(std::string_view task, std::string_view role, bool ascii) {
    std::ostringstream ss;
    ss << "ORIGINAL TASK:\n" << task << "\n\n"
       << "You are one member of a multi-model fusion panel.\n"
       << "Role: " << role << "\n"
       << "Requirements:\n"
       << "- Lead with a direct answer when the task allows.\n"
       << "- Stay on-task; do not invent an unrelated product roadmap.\n"
       << "- Be concrete; note residual uncertainty briefly.\n"
       << "- Answer from your role's angle without repeating generic process talk.\n";
    auto out = ss.str();
    if (ascii) out = sanitize_prompt_text(out, true);
    return out;
}

std::string offline_panel_answer(std::string_view role, std::string_view task) {
    const std::string r(role);
    const std::string t(task);
    const std::string lead = first_sentence(t, 120);
    if (r.find("implementer") != std::string::npos) {
        return "Direct answer: ship a minimal vertical slice first for: " + lead +
               " Prefer typed APIs, tests for handoff wire, and one happy-path CLI demo.";
    }
    if (r.find("test") != std::string::npos) {
        return "Direct answer: gate on echo unit tests + one integration path for: " + lead +
               " Add fixtures for failure modes and cache hits.";
    }
    if (r.find("security") != std::string::npos) {
        return "Direct answer: sandbox tools and deny shell-by-default while solving: " + lead +
               " Log approvals; never embed secrets in reports.";
    }
    if (r.find("architect") != std::string::npos || r.find("api") != std::string::npos) {
        return "Direct answer: keep public surface small and snake_case wire for: " + lead +
               " Separate core runtime from demo orchestration.";
    }
    if (r.find("library") != std::string::npos) {
        return "Direct answer: library-first packaging with CMake install for: " + lead;
    }
    if (r.find("cli") != std::string::npos || r.find("operator") != std::string::npos) {
        return "Direct answer: CLI-first UX with doctor/demos for: " + lead;
    }
    if (r.find("thesis") != std::string::npos) {
        return "Direct answer (thesis): the strongest claim for the task is to proceed with a structured multi-view approach on: " + lead;
    }
    if (r.find("antithesis") != std::string::npos) {
        return "Direct answer (antithesis): a single-view answer may suffice if uncertainty is low for: " + lead;
    }
    if (r.find("mechanism") != std::string::npos) {
        return "Direct answer: require mechanism-linked evidence for: " + lead +
               " Penalize labels without competing alternatives ruled out.";
    }
    if (r.find("adversarial") != std::string::npos || r.find("reviewer") != std::string::npos) {
        return "Direct answer: stress-test the leading claim for: " + lead +
               " Flag overclaim, missing falsifiers, and shared panel bias.";
    }
    if (r.find("retrieval") != std::string::npos || r.find("workup") != std::string::npos) {
        return "Direct answer: plan 3-5 retrieval or workup steps before finalizing: " + lead;
    }
    if (r.find("broad") != std::string::npos || r.find("diagnostician") != std::string::npos) {
        return "Direct answer: cast a wide net of differentials/options for: " + lead +
               " Then rank by fit to stated constraints.";
    }
    if (r.find("synthesis") != std::string::npos) {
        return "Direct answer: merge competing views into one calibrated recommendation for: " + lead;
    }
    if (r.find("release") != std::string::npos || r.find("risk") != std::string::npos) {
        return "Direct answer: ship behind flags and measure regressions for: " + lead;
    }
    return "Direct answer: address the task with role='" + r + "': " + lead +
           " State assumptions, main claim, and residual uncertainty.";
}

PanelJudgeReport judge_fusion_panel(
    std::string_view task,
    std::vector<PanelSlot> panel,
    std::string_view mode
) {
    PanelJudgeReport rep;
    rep.task = std::string(task);
    rep.mode = std::string(mode);
    rep.panel = std::move(panel);

    std::vector<const PanelSlot*> ok;
    for (const auto& s : rep.panel) {
        if (s.confidence != "failed" && !s.answer.empty()) ok.push_back(&s);
    }
    rep.success = !ok.empty();

    rep.consensus = {
        "Use multiple specialist perspectives instead of a single generic answer.",
        "Prefer explicit evidence and residual uncertainty over confident process talk.",
    };
    if (ok.size() >= 2) {
        double sum = 0;
        int pairs = 0;
        for (std::size_t i = 0; i < ok.size(); ++i) {
            for (std::size_t j = i + 1; j < ok.size(); ++j) {
                sum += jaccard(tokens(ok[i]->answer), tokens(ok[j]->answer));
                ++pairs;
            }
        }
        const double mean_j = pairs ? sum / pairs : 0.0;
        if (mean_j >= 0.12) {
            rep.consensus.push_back(
                "Panel answers share topical overlap (mean token Jaccard elevated)."
            );
        } else {
            rep.consensus.push_back(
                "Panel answers are diverse (low mean overlap); treat disagreement as a signal."
            );
        }
    }

    for (std::size_t i = 0; i < ok.size(); ++i) {
        for (std::size_t j = i + 1; j < ok.size(); ++j) {
            const double jac = jaccard(tokens(ok[i]->answer), tokens(ok[j]->answer));
            if (jac < 0.08) {
                rep.contradictions.push_back(
                    ok[i]->role + " vs " + ok[j]->role +
                    ": low topical overlap; compare claims before trusting either alone."
                );
            }
        }
    }
    if (rep.contradictions.size() > 4) rep.contradictions.resize(4);

    rep.coverage_gaps = {
        "Validate claims against primary sources when stakes are high.",
        "Separate infra/provider failures from task-content failures when scoring.",
    };
    if (ok.size() < rep.panel.size()) {
        rep.coverage_gaps.push_back("One or more panel slots failed; coverage is incomplete.");
    }

    for (const auto* s : ok) {
        rep.unique_insights.push_back(
            s->model + " (" + s->role + "): " + first_sentence(s->answer, 160)
        );
    }
    if (rep.unique_insights.size() > 6) rep.unique_insights.resize(6);

    rep.blind_spots = {
        "Shared false assumptions can be amplified when all panelists agree.",
        "A multi-model panel is not a substitute for domain ground truth.",
    };

    const PanelSlot* best = nullptr;
    for (const auto* s : ok) {
        if (!best) best = s;
        if (s->confidence == "high" || s->confidence == "medium-high") best = s;
    }
    if (best) {
        rep.final_answer = first_sentence(best->answer, 400);
        if (ok.size() > 1) {
            rep.final_answer +=
                "\n\nPanel synthesis: combine the direct answer above with residual risks from "
                "adversarial/reviewer slots; do not drop unique concrete claims without a stronger replacement.";
        }
    } else {
        rep.final_answer = "Panel failed: no successful model responses.";
    }

    auto rubric = task_faithful_rubric();
    nlohmann::json per = nlohmann::json::array();
    for (const auto& s : rep.panel) {
        auto r = score_with_rubric(s.answer, rubric);
        per.push_back({{"model", s.model}, {"role", s.role}, {"rubric", r.to_json()}});
    }
    auto merged_r = score_with_rubric(rep.final_answer, rubric);
    rep.rubric = {{"per_slot", std::move(per)}, {"final", merged_r.to_json()}};
    return rep;
}

PanelJudgeReport judge_branch_outputs_as_panel(
    std::string_view task,
    const std::vector<std::pair<std::string, std::string>>& labeled_bodies,
    std::string_view merge_output,
    std::string_view mode
) {
    std::vector<PanelSlot> slots;
    for (const auto& [label, body] : labeled_bodies) {
        PanelSlot s;
        s.model = label;
        s.role = label;
        s.answer = body;
        s.confidence = body.empty() ? "failed" : "medium";
        slots.push_back(std::move(s));
    }
    if (!merge_output.empty()) {
        PanelSlot m;
        m.model = "merger";
        m.role = "merger";
        m.answer = std::string(merge_output);
        m.confidence = "high";
        slots.push_back(std::move(m));
    }
    auto rep = judge_fusion_panel(task, std::move(slots), mode);
    if (!merge_output.empty()) rep.final_answer = std::string(merge_output);
    return rep;
}

double branch_answer_overlap(std::string_view a, std::string_view b) {
    return jaccard(tokens(a), tokens(b));
}

std::string extract_direct_answer_lead(std::string_view text, std::size_t max_chars) {
    std::string s(text);
    // Prefer explicit "Direct answer:" marker (offline panel / answer-first prompts)
    const auto marker = s.find("Direct answer:");
    if (marker != std::string::npos) {
        auto line = s.substr(marker);
        auto nl = line.find('\n');
        if (nl != std::string::npos) line = line.substr(0, nl);
        if (line.size() > max_chars) line = line.substr(0, max_chars);
        return line;
    }
    auto lead = first_sentence(text, max_chars);
    if (!looks_like_direct_answer(lead)) return {};
    return lead;
}

std::string apply_anti_dilution(
    std::string_view merge_output,
    const std::vector<std::pair<std::string, std::string>>& labeled_bodies
) {
    std::string merge(merge_output);
    std::string best_lead;
    for (const auto& [label, body] : labeled_bodies) {
        (void)label;
        auto lead = extract_direct_answer_lead(body);
        if (lead.size() > best_lead.size()) best_lead = lead;
    }
    if (best_lead.empty()) return merge;

    auto merge_lead = extract_direct_answer_lead(merge);
    // Dilution: merge has no direct lead, or merge is much shorter / process-only
    const bool merge_weak =
        merge_lead.empty() ||
        merge.find("insufficient evidence") != std::string::npos ||
        merge.find("cannot determine") != std::string::npos ||
        (merge_lead.size() + 40 < best_lead.size() &&
         merge.find(best_lead.substr(0, std::min<std::size_t>(24, best_lead.size()))) ==
             std::string::npos);

    if (!merge_weak) return merge;
    if (merge.find(best_lead.substr(0, std::min<std::size_t>(20, best_lead.size()))) !=
        std::string::npos) {
        return merge;
    }
    return best_lead + "\n\n[Anti-dilution: preserved concrete branch lead]\n\n" + merge;
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
