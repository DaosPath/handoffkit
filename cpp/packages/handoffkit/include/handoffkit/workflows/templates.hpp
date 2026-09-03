#pragma once

#include <handoffkit/runtime/orchestrator.hpp>
#include <handoffkit/workflows/recipe.hpp>

#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {
namespace templates {

struct WorkflowTemplate {
    std::string id;
    std::string title;
    std::string category;
    std::string description;
    Recipe recipe;
    OrchestratorPlan orchestrator;
    bool use_orchestrator = false;
};

[[nodiscard]] std::vector<WorkflowTemplate> all_templates();
[[nodiscard]] const WorkflowTemplate* find_template(std::string_view id);
[[nodiscard]] std::vector<std::string> template_ids();
[[nodiscard]] std::string list_templates_text();

// Individual template builders (real multi-step definitions)
[[nodiscard]] WorkflowTemplate tpl_basic_team();
[[nodiscard]] WorkflowTemplate tpl_support_escalation();
[[nodiscard]] WorkflowTemplate tpl_coding_review();
[[nodiscard]] WorkflowTemplate tpl_research_digest();
[[nodiscard]] WorkflowTemplate tpl_incident_response();
[[nodiscard]] WorkflowTemplate tpl_product_spec();
[[nodiscard]] WorkflowTemplate tpl_release_checklist();
[[nodiscard]] WorkflowTemplate tpl_security_review();
[[nodiscard]] WorkflowTemplate tpl_data_migration();
[[nodiscard]] WorkflowTemplate tpl_customer_onboarding();
[[nodiscard]] WorkflowTemplate tpl_sre_capacity();
[[nodiscard]] WorkflowTemplate tpl_docs_refresh();

}  // namespace templates
}  // namespace handoffkit
