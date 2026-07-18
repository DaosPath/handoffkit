#pragma once

#include <handoffkit/demos/fusion/types.hpp>
#include <handoffkit/error.hpp>

#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace handoffkit {
namespace demos {
namespace fusion {

/// Strip UTF-8 BOM and map common Windows-1252 punctuation to ASCII.
[[nodiscard]] std::string sanitize_prompt_text(std::string_view input, bool ascii_only = true);

/// Truncate with explicit marker; never cuts mid-marker awkwardly for short limits.
[[nodiscard]] std::string truncate_with_marker(std::string_view input, std::size_t max_chars,
                                              std::string_view marker = "\n...[truncated]...\n");

/// Simple {{key}} substitution. Unknown keys left as-is or cleared per flag.
[[nodiscard]] std::string render_template(
    std::string_view tmpl,
    const std::unordered_map<std::string, std::string>& vars,
    bool remove_unknown = false
);

struct PromptSection {
    std::string name;
    std::string content;
    std::size_t max_chars = 0;  // 0 = unlimited
};

class PromptBuilder {
public:
    PromptBuilder& set_system(std::string system);
    PromptBuilder& set_task(std::string task);
    PromptBuilder& add_section(std::string name, std::string content, std::size_t max_chars = 0);
    PromptBuilder& set_ascii_sanitize(bool on);
    PromptBuilder& set_global_max(std::size_t max_chars);

    [[nodiscard]] std::string build() const;
    [[nodiscard]] std::string system() const { return system_; }
    [[nodiscard]] std::string task() const { return task_; }

private:
    std::string system_;
    std::string task_;
    std::vector<PromptSection> sections_;
    bool ascii_sanitize_ = true;
    std::size_t global_max_ = 0;
};

/// Options for tier-aware prompt framing (depth + skills + structured handoff inject).
struct FrameOptions {
    FusionPromptDepth depth = FusionPromptDepth::Standard;
    bool ascii = true;
    bool task_faithful = true;
    bool shipping_sections = false;
    int max_branch_bullets = 10;
    int max_skeptic_bullets = 6;
    int evidence_min_points = 2;
    std::vector<std::string> skills;
    std::vector<std::string> tool_slots;
    /// Pre-formatted structured handoff block (markdown section body); empty = none.
    std::string prior_handoff_section;
    /// Live web research markdown (from native explorer tools); empty = none.
    std::string web_research_section;
    /// When true, tool_slots are real executable tools (not only scaffolds).
    bool tools_are_live = false;
};

/// Format a HandoffState into a labeled section for successor prompts (not a raw blob).
[[nodiscard]] std::string format_handoff_prompt_section(const HandoffState& h);

/// Build a structured step handoff (summary truncated; decisions/next_steps/context_refs filled).
[[nodiscard]] HandoffState make_fusion_step_handoff(
    std::string_view task,
    std::string_view from_agent,
    std::string_view to_agent,
    std::string_view branch_label,
    std::string_view output_body,
    const FusionCapabilityPack& pack,
    std::string_view step_kind  // "architect" | "skeptic" | "merge_ready"
);

/// Frames used by fusion engine (profile-independent helpers).
[[nodiscard]] std::string frame_branch_task(
    std::string_view task,
    std::string_view branch_label,
    std::string_view focus,
    bool ascii = true
);

[[nodiscard]] std::string frame_branch_task(
    std::string_view task,
    std::string_view branch_label,
    std::string_view focus,
    const FrameOptions& opts
);

[[nodiscard]] std::string frame_skeptic_task(
    std::string_view task,
    std::string_view proposal,
    std::string_view angle,
    bool ascii = true
);

[[nodiscard]] std::string frame_skeptic_task(
    std::string_view task,
    std::string_view proposal,
    std::string_view angle,
    const FrameOptions& opts
);

[[nodiscard]] std::string frame_merge_task(
    std::string_view task,
    std::string_view branch_a_label,
    std::string_view branch_a_body,
    std::string_view branch_b_label,
    std::string_view branch_b_body,
    bool task_faithful,
    bool shipping_sections,
    bool ascii = true
);

[[nodiscard]] std::string frame_merge_task(
    std::string_view task,
    std::string_view branch_a_label,
    std::string_view branch_a_body,
    std::string_view branch_b_label,
    std::string_view branch_b_body,
    const FrameOptions& opts,
    std::string_view handoff_a = {},
    std::string_view handoff_b = {}
);

[[nodiscard]] std::string frame_merge_multi(
    std::string_view task,
    const std::vector<std::pair<std::string, std::string>>& labeled_bodies,
    bool task_faithful,
    bool ascii = true
);

[[nodiscard]] std::string frame_merge_multi(
    std::string_view task,
    const std::vector<std::pair<std::string, std::string>>& labeled_bodies,
    const FrameOptions& opts,
    const std::vector<std::string>& handoff_sections = {}
);

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
