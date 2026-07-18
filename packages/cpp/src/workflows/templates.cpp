#include <handoffkit/workflows/templates.hpp>

#include <sstream>

namespace handoffkit {
namespace templates {
namespace {

RecipeStep step(const char* name, const char* agent, const char* instruction, bool handoff = true) {
    return RecipeStep{name, agent, instruction, handoff};
}

Recipe make_recipe(
    const char* name,
    const char* description,
    ProtocolMode mode,
    std::vector<RecipeStep> steps
) {
    Recipe r;
    r.name = name;
    r.description = description;
    r.protocol = mode;
    r.steps = std::move(steps);
    r.metadata = {{"template", true}};
    return r;
}

}  // namespace

WorkflowTemplate tpl_basic_team() {
    WorkflowTemplate t;
    t.id = "basic_team";
    t.title = "Basic three-agent team";
    t.category = "core";
    t.description = "Architect → Coder → Reviewer sequential recipe";
    t.use_orchestrator = false;
    t.recipe = make_recipe(
        "basic_team",
        "Design, implement, review",
        ProtocolMode::HybridState,
        {
            step("design", "Architect", "Produce architecture decisions and constraints"),
            step("implement", "Coder", "Implement the design with tests in mind"),
            step("review", "Reviewer", "List defects, risks, and merge conditions"),
        }
    );
    return t;
}

WorkflowTemplate tpl_support_escalation() {
    WorkflowTemplate t;
    t.id = "support_escalation";
    t.title = "Support escalation";
    t.category = "showcase";
    t.description = "Orchestrated L1→L2→IC with quality gate";
    t.use_orchestrator = true;
    t.orchestrator = Orchestrator::support_escalation_plan();
    t.recipe = make_recipe(
        "support_escalation_recipe",
        "Fallback recipe form",
        ProtocolMode::HybridState,
        {
            step("triage", "L1_Support", "Gather facts and impact"),
            step("deep_dive", "L2_Support", "Technical root-cause hypotheses"),
            step("command", "Incident_Commander", "Own escalation and comms plan"),
        }
    );
    return t;
}

WorkflowTemplate tpl_coding_review() {
    WorkflowTemplate t;
    t.id = "coding_review";
    t.title = "Coding review";
    t.category = "showcase";
    t.description = "Author → Reviewer (gated) → Maintainer";
    t.use_orchestrator = true;
    t.orchestrator = Orchestrator::coding_ship_plan();
    t.recipe = make_recipe(
        "coding_review_recipe",
        "Patch review recipe",
        ProtocolMode::HybridState,
        {
            step("author", "Author", "Explain intent and test plan"),
            step("review", "Reviewer", "List blocking issues and nits"),
            step("maintain", "Maintainer", "Accept/reject with conditions"),
        }
    );
    return t;
}

WorkflowTemplate tpl_research_digest() {
    WorkflowTemplate t;
    t.id = "research_digest";
    t.title = "Research digest";
    t.category = "showcase";
    t.description = "Collect → analyze → edit under compressed protocol";
    t.use_orchestrator = true;
    t.orchestrator = Orchestrator::research_then_edit_plan();
    t.recipe = make_recipe(
        "research_digest_recipe",
        "Research recipe",
        ProtocolMode::Compressed,
        {
            step("collect", "Librarian", "Collect offline notes and citations"),
            step("analyze", "Analyst", "Cluster findings and tradeoffs"),
            step("edit", "Editor", "Write executive summary"),
        }
    );
    return t;
}

WorkflowTemplate tpl_incident_response() {
    WorkflowTemplate t;
    t.id = "incident_response";
    t.title = "Incident response";
    t.category = "ops";
    t.description = "Oncall mitigation with rescue path";
    t.use_orchestrator = true;
    t.orchestrator = Orchestrator::incident_with_rescue_plan();
    t.recipe = make_recipe(
        "incident_response_recipe",
        "Incident recipe",
        ProtocolMode::HybridState,
        {
            step("mitigate", "Oncall", "Mitigate and capture timeline"),
            step("comms", "Comms", "Draft internal/customer updates"),
            step("scribe", "Scribe", "Record decisions and follow-ups"),
        }
    );
    return t;
}

WorkflowTemplate tpl_product_spec() {
    WorkflowTemplate t;
    t.id = "product_spec";
    t.title = "Product to engineering";
    t.category = "product";
    t.description = "PM → Designer → TechLead orchestrated handoff";
    t.use_orchestrator = true;
    t.orchestrator = Orchestrator::product_to_eng_plan();
    t.recipe = make_recipe(
        "product_spec_recipe",
        "PRD handoff recipe",
        ProtocolMode::HybridState,
        {
            step("prd", "PM", "Goals, non-goals, acceptance"),
            step("ux", "Designer", "UX edges and empty states"),
            step("eng", "TechLead", "Milestones and risks"),
        }
    );
    return t;
}

WorkflowTemplate tpl_release_checklist() {
    WorkflowTemplate t;
    t.id = "release_checklist";
    t.title = "Release checklist pipeline";
    t.category = "workflow";
    t.description = "Planner → Releaser → Verifier for C++ package release";
    t.use_orchestrator = false;
    t.recipe = make_recipe(
        "release_checklist",
        "Release steps",
        ProtocolMode::HybridState,
        {
            step("plan", "Planner", "List version bumps and changelog sections"),
            step("release", "Releaser", "List tarball, Conan, vcpkg, attestation steps"),
            step("verify", "Verifier", "ctest, CLI demos, install consumer checks"),
        }
    );
    return t;
}

WorkflowTemplate tpl_security_review() {
    WorkflowTemplate t;
    t.id = "security_review";
    t.title = "Security review";
    t.category = "security";
    t.description = "Threat model → review → signoff";
    t.use_orchestrator = false;
    t.recipe = make_recipe(
        "security_review",
        "Security review recipe",
        ProtocolMode::HybridState,
        {
            step("model", "Analyst", "Map trust boundaries for CLI tools and reports"),
            step("review", "Reviewer", "List abuse cases and mitigations"),
            step("signoff", "Maintainer", "Accept residual risk or block"),
        }
    );
    return t;
}

WorkflowTemplate tpl_data_migration() {
    WorkflowTemplate t;
    t.id = "data_migration";
    t.title = "Data migration expand/contract";
    t.category = "coding";
    t.description = "Design expand/contract migration with verification";
    t.use_orchestrator = false;
    t.recipe = make_recipe(
        "data_migration",
        "Migration recipe",
        ProtocolMode::HybridState,
        {
            step("design", "Architect", "Expand/contract phases and rollback"),
            step("implement", "Coder", "Migration scripts and dual-read plan"),
            step("verify", "Reviewer", "Data integrity checks and monitoring"),
        }
    );
    return t;
}

WorkflowTemplate tpl_customer_onboarding() {
    WorkflowTemplate t;
    t.id = "customer_onboarding";
    t.title = "Customer onboarding";
    t.category = "support";
    t.description = "Onboarding specialist chain for new workspace setup";
    t.use_orchestrator = false;
    t.recipe = make_recipe(
        "customer_onboarding",
        "Onboarding recipe",
        ProtocolMode::HybridMin,
        {
            step("discover", "L1_Support", "Capture goals and constraints"),
            step("configure", "L2_Support", "Configuration checklist"),
            step("enable", "Incident_Commander", "Go-live criteria and owners"),
        }
    );
    return t;
}

WorkflowTemplate tpl_sre_capacity() {
    WorkflowTemplate t;
    t.id = "sre_capacity";
    t.title = "SRE capacity plan";
    t.category = "ops";
    t.description = "Capacity analysis and scale recommendations";
    t.use_orchestrator = false;
    t.recipe = make_recipe(
        "sre_capacity",
        "Capacity recipe",
        ProtocolMode::HybridState,
        {
            step("observe", "Oncall", "Summarize lag/error budget signals offline"),
            step("plan", "Analyst", "Scale/throttle options"),
            step("decide", "Scribe", "Decision log and follow-ups"),
        }
    );
    return t;
}

WorkflowTemplate tpl_docs_refresh() {
    WorkflowTemplate t;
    t.id = "docs_refresh";
    t.title = "Docs refresh";
    t.category = "research";
    t.description = "Docs IA and refresh pipeline";
    t.use_orchestrator = false;
    t.recipe = make_recipe(
        "docs_refresh",
        "Docs recipe",
        ProtocolMode::Compressed,
        {
            step("audit", "Librarian", "Inventory stale pages"),
            step("outline", "Analyst", "Propose IA changes"),
            step("draft", "Editor", "Draft refreshed quickstart outline"),
        }
    );
    return t;
}

std::vector<WorkflowTemplate> all_templates() {
    return {
        tpl_basic_team(),
        tpl_support_escalation(),
        tpl_coding_review(),
        tpl_research_digest(),
        tpl_incident_response(),
        tpl_product_spec(),
        tpl_release_checklist(),
        tpl_security_review(),
        tpl_data_migration(),
        tpl_customer_onboarding(),
        tpl_sre_capacity(),
        tpl_docs_refresh(),
    };
}

const WorkflowTemplate* find_template(std::string_view id) {
    static const auto templates = all_templates();
    for (const auto& t : templates) {
        if (t.id == id) return &t;
    }
    return nullptr;
}

std::vector<std::string> template_ids() {
    std::vector<std::string> ids;
    for (const auto& t : all_templates()) ids.push_back(t.id);
    return ids;
}

std::string list_templates_text() {
    std::ostringstream ss;
    ss << "Workflow templates:\n";
    for (const auto& t : all_templates()) {
        ss << "  - " << t.id << " [" << t.category << "] " << t.title
           << (t.use_orchestrator ? " (orchestrator)" : " (recipe)") << "\n"
           << "      " << t.description << "\n";
    }
    return ss.str();
}

}  // namespace templates
}  // namespace handoffkit
