#include <handoffkit/demos/fusion/prompt.hpp>

#include <sstream>

namespace handoffkit {
namespace demos {
namespace fusion {
namespace {

std::string join_csv(const std::vector<std::string>& items) {
    std::ostringstream ss;
    for (std::size_t i = 0; i < items.size(); ++i) {
        if (i) ss << ", ";
        ss << items[i];
    }
    return ss.str();
}

void append_skill_tool_block(std::ostringstream& ss, const FrameOptions& opts) {
    if (!opts.skills.empty()) {
        ss << "Skills to apply: " << join_csv(opts.skills) << ".\n";
    }
    if (!opts.tool_slots.empty()) {
        if (opts.tools_are_live) {
            ss << "Live tools already run (HandoffKit native explorer -> Markdown). "
               << "Ground claims in the web research section when present. Tool inventory: "
               << join_csv(opts.tool_slots) << ".\n";
        } else {
            ss << "Declared tool slots (use as reasoning scaffolds; do not invent live tool output): "
               << join_csv(opts.tool_slots) << ".\n";
        }
    }
    if (!opts.web_research_section.empty()) {
        ss << "\n" << opts.web_research_section << "\n";
    }
    if (!opts.panel_analysis_section.empty()) {
        ss << "\n" << opts.panel_analysis_section << "\n";
    }
}

const char* depth_branch_guidance(FusionPromptDepth depth) {
    switch (depth) {
        case FusionPromptDepth::Compact:
            return "Answer-first: lead with the best direct answer, then 3-6 supporting bullets. Keep it short.";
        case FusionPromptDepth::Standard:
            return "Answer-first, then assumptions, main points, and tradeoffs. Stay concrete and on-task.";
        case FusionPromptDepth::Deep:
            return "Answer-first, then evidence-quality notes, alternatives, and failure modes. Do not hide the conclusion.";
        case FusionPromptDepth::Research:
            return "Answer-first research: state best answer + confidence, then supporting and counter claims, then unknowns.";
        case FusionPromptDepth::Exhaustive:
            return "Answer-first exhaustive: best answer, competing answers, adversarial checks, residual risks, open questions.";
    }
    return "Stay concrete and on-task. Lead with a direct answer when the task allows.";
}

const char* depth_merge_guidance(FusionPromptDepth depth) {
    switch (depth) {
        case FusionPromptDepth::Compact:
            return "Lead with ONE direct final answer, then a short structured support block.";
        case FusionPromptDepth::Standard:
            return "Lead with the best direct answer; deduplicate; keep strongest points; note uncertainty briefly.";
        case FusionPromptDepth::Deep:
            return "Lead with the best direct answer; resolve contradictions; keep strongest evidence; residual risks last.";
        case FusionPromptDepth::Research:
            return "Lead with the best calibrated answer + confidence; then consensus, disagreements, gaps, next checks.";
        case FusionPromptDepth::Exhaustive:
            return "Lead with the best answer; preserve unique strong claims from every branch; then risks and open questions.";
    }
    return "Merge into one coherent answer; lead with the direct conclusion.";
}

}  // namespace

PromptBuilder& PromptBuilder::set_system(std::string system) {
    system_ = std::move(system);
    return *this;
}

PromptBuilder& PromptBuilder::set_task(std::string task) {
    task_ = std::move(task);
    return *this;
}

PromptBuilder& PromptBuilder::add_section(std::string name, std::string content, std::size_t max_chars) {
    sections_.push_back(PromptSection{std::move(name), std::move(content), max_chars});
    return *this;
}

PromptBuilder& PromptBuilder::set_ascii_sanitize(bool on) {
    ascii_sanitize_ = on;
    return *this;
}

PromptBuilder& PromptBuilder::set_global_max(std::size_t max_chars) {
    global_max_ = max_chars;
    return *this;
}

std::string PromptBuilder::build() const {
    std::ostringstream ss;
    if (!system_.empty()) {
        ss << "Role: " << system_ << "\n";
    }
    if (!task_.empty()) {
        ss << "Task: " << task_ << "\n";
    }
    for (const auto& sec : sections_) {
        std::string body = sec.content;
        if (sec.max_chars > 0) body = truncate_with_marker(body, sec.max_chars);
        ss << "\n## " << sec.name << "\n" << body << "\n";
    }
    std::string out = ss.str();
    if (ascii_sanitize_) out = sanitize_prompt_text(out, true);
    if (global_max_ > 0) out = truncate_with_marker(out, global_max_);
    return out;
}

std::string format_handoff_prompt_section(const HandoffState& h) {
    std::ostringstream ss;
    ss << "### Structured handoff\n"
       << "- task: " << h.task << "\n"
       << "- from: " << h.from_agent << "\n"
       << "- to: " << h.to_agent << "\n"
       << "- summary:\n" << h.summary << "\n";
    if (!h.decisions.empty()) {
        ss << "- decisions:\n";
        for (const auto& d : h.decisions) ss << "  - " << d << "\n";
    }
    if (!h.next_steps.empty()) {
        ss << "- next_steps:\n";
        for (const auto& n : h.next_steps) ss << "  - " << n << "\n";
    }
    if (!h.context_refs.empty()) {
        ss << "- context_refs:\n";
        for (const auto& c : h.context_refs) ss << "  - " << c << "\n";
    }
    if (!h.errors.empty()) {
        ss << "- errors:\n";
        for (const auto& e : h.errors) ss << "  - " << e << "\n";
    }
    return ss.str();
}

HandoffState make_fusion_step_handoff(
    std::string_view task,
    std::string_view from_agent,
    std::string_view to_agent,
    std::string_view branch_label,
    std::string_view output_body,
    const FusionCapabilityPack& pack,
    std::string_view step_kind
) {
    HandoffState h;
    h.task = std::string(task);
    h.from_agent = std::string(from_agent);
    h.to_agent = std::string(to_agent);
    const std::size_t lim = pack.handoff_summary_chars > 0
        ? static_cast<std::size_t>(pack.handoff_summary_chars)
        : 900;
    h.summary = truncate_with_marker(output_body, lim);
    h.decisions = {
        "Branch/label: " + std::string(branch_label),
        "Step: " + std::string(step_kind),
        "Capability pack: " + pack.pack_id,
        "Prompt depth: " + fusion_prompt_depth_to_string(pack.depth),
    };
    if (!pack.skills.empty()) {
        h.decisions.push_back("Skills: " + join_csv(pack.skills));
    }
    if (step_kind == "architect") {
        h.next_steps = {
            "Critique or peer-compare this branch",
            "Preserve task domain in merge",
        };
    } else if (step_kind == "skeptic") {
        h.next_steps = {
            "Fold critique into merge",
            "Flag residual risks in final answer",
        };
    } else {
        h.next_steps = {
            "Merge with peer branch handoffs",
            "Answer the original task directly",
        };
    }
    h.context_refs = {
        "branch:" + std::string(branch_label),
        "pack:" + pack.pack_id,
        "step:" + std::string(step_kind),
    };
    for (const auto& skill : pack.skills) {
        h.context_refs.push_back("skill:" + skill);
    }
    for (const auto& slot : pack.tool_slots) {
        h.context_refs.push_back("tool_slot:" + slot);
    }
    h.metadata = {
        {"pack_id", pack.pack_id},
        {"depth", fusion_prompt_depth_to_string(pack.depth)},
        {"step_kind", std::string(step_kind)},
        {"branch_label", std::string(branch_label)},
    };
    return h;
}

std::string frame_branch_task(
    std::string_view task,
    std::string_view branch_label,
    std::string_view focus,
    bool ascii
) {
    FrameOptions opts;
    opts.ascii = ascii;
    return frame_branch_task(task, branch_label, focus, opts);
}

std::string frame_branch_task(
    std::string_view task,
    std::string_view branch_label,
    std::string_view focus,
    const FrameOptions& opts
) {
    std::ostringstream ss;
    ss << "ORIGINAL TASK:\n" << task << "\n\n"
       << "[BRANCH - " << branch_label << "]\n"
       << "Focus: " << focus << "\n"
       << depth_branch_guidance(opts.depth) << "\n";
    append_skill_tool_block(ss, opts);
    ss << "Requirements:\n"
       << "- Stay faithful to the original task domain (do not reframe into unrelated product roadmaps).\n"
       << "- Lead with a direct answer to the question when possible (name, number, verdict, or best hypothesis).\n"
       << "- Be concrete; aim for up to " << opts.max_branch_bullets
       << " short bullets or a short structured answer AFTER the direct answer.\n"
       << "- Include at least " << opts.evidence_min_points
       << " concrete claims, assumptions, or evidence-like points when the task allows.\n"
       << "- Prefer specific claims over generic process talk; do not refuse to answer if a best guess exists.\n";
    if (!opts.prior_handoff_section.empty()) {
        ss << "\n## Prior structured handoff\n" << opts.prior_handoff_section << "\n";
    }
    auto out = ss.str();
    if (opts.ascii) out = sanitize_prompt_text(out, true);
    return out;
}

std::string frame_skeptic_task(
    std::string_view task,
    std::string_view proposal,
    std::string_view angle,
    bool ascii
) {
    FrameOptions opts;
    opts.ascii = ascii;
    return frame_skeptic_task(task, proposal, angle, opts);
}

std::string frame_skeptic_task(
    std::string_view task,
    std::string_view proposal,
    std::string_view angle,
    const FrameOptions& opts
) {
    std::ostringstream ss;
    ss << "ORIGINAL TASK:\n" << task << "\n\n"
       << "You are the skeptic (" << angle << ").\n"
       << "Critique the proposal for gaps, weak evidence, hidden assumptions, and domain drift.\n"
       << "Do not abandon the original task domain.\n"
       << "Max " << opts.max_skeptic_bullets << " bullets of risks/gaps/misses.\n";
    append_skill_tool_block(ss, opts);
    if (!opts.prior_handoff_section.empty()) {
        ss << "\n## Prior structured handoff (use this; do not ignore structured fields)\n"
           << opts.prior_handoff_section << "\n";
    }
    ss << "\n## Proposal body\n" << proposal << "\n";
    auto out = ss.str();
    if (opts.ascii) out = sanitize_prompt_text(out, true);
    return out;
}

std::string frame_merge_task(
    std::string_view task,
    std::string_view branch_a_label,
    std::string_view branch_a_body,
    std::string_view branch_b_label,
    std::string_view branch_b_body,
    bool task_faithful,
    bool shipping_sections,
    bool ascii
) {
    FrameOptions opts;
    opts.task_faithful = task_faithful;
    opts.shipping_sections = shipping_sections;
    opts.ascii = ascii;
    return frame_merge_task(
        task, branch_a_label, branch_a_body, branch_b_label, branch_b_body, opts, {}, {}
    );
}

std::string frame_merge_task(
    std::string_view task,
    std::string_view branch_a_label,
    std::string_view branch_a_body,
    std::string_view branch_b_label,
    std::string_view branch_b_body,
    const FrameOptions& opts,
    std::string_view handoff_a,
    std::string_view handoff_b
) {
    std::ostringstream ss;
    ss << "ORIGINAL TASK:\n" << task << "\n\n";
    append_skill_tool_block(ss, opts);
    if (!handoff_a.empty()) {
        ss << "## Structured handoff — branch A (" << branch_a_label << ")\n"
           << handoff_a << "\n";
    }
    if (!handoff_b.empty()) {
        ss << "## Structured handoff — branch B (" << branch_b_label << ")\n"
           << handoff_b << "\n";
    }
    ss << "=== BRANCH A (" << branch_a_label << ") ===\n" << branch_a_body << "\n\n"
       << "=== BRANCH B (" << branch_b_label << ") ===\n" << branch_b_body << "\n\n";
    ss << depth_merge_guidance(opts.depth) << "\n";
    if (opts.task_faithful) {
        ss << "Merge into a single best answer to the ORIGINAL TASK above.\n"
           << "Rules:\n"
           << "- FIRST LINE / FIRST SECTION: the direct answer (name, number, verdict, or best hypothesis).\n"
           << "- Then support with the strongest points from both branches; preserve unique useful detail.\n"
           << "- Do NOT invent a product roadmap, CLI design, or packaging plan unless the task asks for it.\n"
           << "- Use structured handoff summary/decisions/next_steps when present; do not rely only on raw blobs.\n"
           << "- Deduplicate, keep strongest evidence, note residual uncertainty AFTER the answer.\n"
           << "- Do not collapse to 'insufficient evidence' if either branch offered a concrete best answer.\n"
           << "- Prefer concrete conclusions over generic process advice.\n";
    } else if (opts.shipping_sections) {
        ss << "Merge into a single plan with sections: Goals, Architecture, CLI, Risks, Next steps.\n"
           << "Prefer production-ready choices. Keep under 25 short bullets total.\n";
    } else {
        ss << "Merge both branches into one coherent answer. Deduplicate and list residual risks.\n";
    }
    auto out = ss.str();
    if (opts.ascii) out = sanitize_prompt_text(out, true);
    return out;
}

std::string frame_merge_multi(
    std::string_view task,
    const std::vector<std::pair<std::string, std::string>>& labeled_bodies,
    bool task_faithful,
    bool ascii
) {
    FrameOptions opts;
    opts.task_faithful = task_faithful;
    opts.ascii = ascii;
    return frame_merge_multi(task, labeled_bodies, opts, {});
}

std::string frame_merge_multi(
    std::string_view task,
    const std::vector<std::pair<std::string, std::string>>& labeled_bodies,
    const FrameOptions& opts,
    const std::vector<std::string>& handoff_sections
) {
    std::ostringstream ss;
    ss << "ORIGINAL TASK:\n" << task << "\n\n";
    append_skill_tool_block(ss, opts);
    for (std::size_t i = 0; i < handoff_sections.size(); ++i) {
        ss << "## Structured handoff — branch " << (i + 1) << "\n"
           << handoff_sections[i] << "\n";
    }
    for (std::size_t i = 0; i < labeled_bodies.size(); ++i) {
        ss << "=== BRANCH " << (i + 1) << " (" << labeled_bodies[i].first << ") ===\n"
           << labeled_bodies[i].second << "\n\n";
    }
    ss << depth_merge_guidance(opts.depth) << "\n";
    if (opts.task_faithful) {
        ss << "Synthesize all branches into one answer to the ORIGINAL TASK.\n"
           << "Lead with the direct answer, then merge unique strong points from every branch.\n"
           << "Do not change the problem into a software packaging exercise.\n"
           << "Do not dilute a concrete answer into pure uncertainty theater.\n"
           << "Use structured handoff fields (summary/decisions/next_steps) when present.\n";
    } else {
        ss << "Synthesize all branches into one coherent plan. Lead with the decision.\n";
    }
    auto out = ss.str();
    if (opts.ascii) out = sanitize_prompt_text(out, true);
    return out;
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
