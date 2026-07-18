#include <handoffkit/demos/fusion/merge_strategy.hpp>
#include <handoffkit/demos/fusion/prompt.hpp>

#include <algorithm>
#include <map>
#include <sstream>

namespace handoffkit {
namespace demos {
namespace fusion {

std::string merge_strategy_to_string(MergeStrategyKind k) {
    switch (k) {
        case MergeStrategyKind::TaskFaithfulPrompt: return "task_faithful_prompt";
        case MergeStrategyKind::ShippingSectionsPrompt: return "shipping_sections_prompt";
        case MergeStrategyKind::BulletVoteSynthesize: return "bullet_vote";
        case MergeStrategyKind::ConflictAnnotate: return "conflict_annotate";
    }
    return "task_faithful_prompt";
}

Result<MergeStrategyKind> merge_strategy_from_string(std::string_view s) {
    if (s == "task_faithful_prompt" || s == "faithful") return MergeStrategyKind::TaskFaithfulPrompt;
    if (s == "shipping_sections_prompt" || s == "shipping") return MergeStrategyKind::ShippingSectionsPrompt;
    if (s == "bullet_vote" || s == "vote") return MergeStrategyKind::BulletVoteSynthesize;
    if (s == "conflict_annotate" || s == "conflicts") return MergeStrategyKind::ConflictAnnotate;
    return Error::invalid_argument("unknown merge strategy: " + std::string(s), "strategy");
}

nlohmann::json MergePlan::to_json() const {
    return nlohmann::json{
        {"kind", merge_strategy_to_string(kind)},
        {"ascii", ascii},
        {"include_diff_notes", include_diff_notes},
    };
}

MergePlan merge_plan_for_pack(const RolePack& pack) {
    MergePlan p;
    if (pack.shipping_merge_sections) p.kind = MergeStrategyKind::ShippingSectionsPrompt;
    else p.kind = MergeStrategyKind::TaskFaithfulPrompt;
    return p;
}

std::string build_merge_user_prompt(
    std::string_view task,
    const std::vector<std::pair<std::string, std::string>>& labeled_bodies,
    const MergePlan& plan,
    const RolePack& pack
) {
    if (labeled_bodies.size() >= 2 &&
        (plan.kind == MergeStrategyKind::TaskFaithfulPrompt ||
         plan.kind == MergeStrategyKind::ShippingSectionsPrompt)) {
        return frame_merge_task(
            task,
            labeled_bodies[0].first,
            labeled_bodies[0].second,
            labeled_bodies[1].first,
            labeled_bodies[1].second,
            plan.kind == MergeStrategyKind::TaskFaithfulPrompt || pack.task_faithful_merge,
            plan.kind == MergeStrategyKind::ShippingSectionsPrompt || pack.shipping_merge_sections,
            plan.ascii
        );
    }
    if (plan.kind == MergeStrategyKind::BulletVoteSynthesize) {
        return offline_bullet_vote_merge(task, labeled_bodies);
    }
    // Conflict annotate: dual frame + explicit diff notes
    std::ostringstream ss;
    ss << task << "\n\n";
    for (std::size_t i = 0; i < labeled_bodies.size(); ++i) {
        ss << "=== BRANCH " << (i + 1) << " (" << labeled_bodies[i].first << ") ===\n"
           << labeled_bodies[i].second << "\n\n";
    }
    if (plan.include_diff_notes && labeled_bodies.size() >= 2) {
        auto diff = compare_branch_outputs(labeled_bodies[0].second, labeled_bodies[1].second);
        ss << "=== DIFF NOTES ===\n"
           << "token_jaccard=" << diff.token_jaccard << "\n"
           << "shared_bullets=" << diff.shared_bullets << "\n";
        for (const auto& c : diff.conflicts) ss << "- conflict: " << c << "\n";
        ss << "\nMerge by resolving conflicts explicitly; answer the ORIGINAL TASK.\n";
    }
    auto out = ss.str();
    if (plan.ascii) out = sanitize_prompt_text(out, true);
    return out;
}

std::string offline_bullet_vote_merge(
    std::string_view task,
    const std::vector<std::pair<std::string, std::string>>& labeled_bodies
) {
    std::map<std::string, int> votes;
    std::map<std::string, std::vector<std::string>> sources;
    for (const auto& [label, body] : labeled_bodies) {
        for (const auto& b : extract_bullet_lines(body)) {
            ++votes[b];
            sources[b].push_back(label);
        }
    }
    std::vector<std::pair<std::string, int>> ranked(votes.begin(), votes.end());
    std::sort(ranked.begin(), ranked.end(), [](const auto& x, const auto& y) {
        if (x.second != y.second) return x.second > y.second;
        return x.first < y.first;
    });

    std::ostringstream ss;
    ss << "Offline bullet-vote merge for task:\n" << task << "\n\n";
    ss << "Consensus bullets (vote >= 2 or top items):\n";
    int emitted = 0;
    for (const auto& [bullet, v] : ranked) {
        if (v >= 2 || emitted < 8) {
            ss << "- (" << v << ") " << bullet;
            ss << "  [from:";
            for (const auto& s : sources[bullet]) ss << " " << s;
            ss << "]\n";
            ++emitted;
        }
    }
    if (emitted == 0) {
        ss << "- (no bullets extracted; concatenate short summaries)\n";
        for (const auto& [label, body] : labeled_bodies) {
            ss << "- [" << label << "] " << body.substr(0, std::min<std::size_t>(body.size(), 160)) << "\n";
        }
    }
    if (labeled_bodies.size() >= 2) {
        auto diff = compare_branch_outputs(labeled_bodies[0].second, labeled_bodies[1].second);
        if (!diff.conflicts.empty()) {
            ss << "\nUnresolved tensions:\n";
            for (const auto& c : diff.conflicts) ss << "- " << c << "\n";
        }
    }
    return ss.str();
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
