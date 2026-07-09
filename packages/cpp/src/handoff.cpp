#include <handoffkit/handoff.hpp>
#include <sstream>
#include <algorithm>

namespace handoffkit {

static std::string trim(const std::string& str) {
    if (str.empty()) return "";
    size_t first = str.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return "";
    size_t last = str.find_last_not_of(" \t\r\n");
    return str.substr(first, (last - first + 1));
}

static std::string to_lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c){ return std::tolower(c); });
    return s;
}

std::string HandoffState::to_markdown() const {
    std::stringstream ss;
    ss << "# HandoffState\n\n";
    ss << "Task: " << task << "\n";
    ss << "From: " << (from_agent.empty() ? "-" : from_agent) << "\n";
    ss << "To: " << (to_agent.empty() ? "-" : to_agent) << "\n\n";
    ss << "## Summary\n" << (summary.empty() ? "-" : summary) << "\n\n";

    auto add_list_section = [&](const std::string& title, const std::vector<std::string>& items) {
        ss << "## " << title << "\n";
        if (items.empty()) {
            ss << "-\n";
        } else {
            for (const auto& item : items) {
                ss << "- " << item << "\n";
            }
        }
        ss << "\n";
    };

    add_list_section("Decisions", decisions);
    add_list_section("Files", important_files);
    add_list_section("Errors", errors);
    add_list_section("Next Steps", next_steps);
    add_list_section("Context Refs", context_refs);

    return trim(ss.str());
}

HandoffState HandoffState::from_markdown(const std::string& text) {
    HandoffState state;
    std::stringstream ss(text);
    std::string line;
    std::string current_section;
    std::vector<std::string> summary_lines;

    while (std::getline(ss, line)) {
        std::string line_str = trim(line);
        if (line_str.empty()) continue;

        if (line_str.rfind("Task:", 0) == 0) {
            state.task = trim(line_str.substr(5));
            continue;
        }
        if (line_str.rfind("From:", 0) == 0) {
            state.from_agent = trim(line_str.substr(5));
            if (state.from_agent == "-") state.from_agent.clear();
            continue;
        }
        if (line_str.rfind("To:", 0) == 0) {
            state.to_agent = trim(line_str.substr(3));
            if (state.to_agent == "-") state.to_agent.clear();
            continue;
        }

        if (line_str.rfind("## ", 0) == 0) {
            current_section = to_lower(trim(line_str.substr(3)));
            continue;
        }

        if (current_section == "summary") {
            summary_lines.push_back(line_str);
        } else if (line_str.rfind("-", 0) == 0) {
            std::string val = trim(line_str.substr(1));
            if (val.empty() || val == "-") continue;
            if (current_section == "decisions") {
                state.decisions.push_back(val);
            } else if (current_section == "files" || current_section == "important files" || current_section == "important_files") {
                state.important_files.push_back(val);
            } else if (current_section == "errors") {
                state.errors.push_back(val);
            } else if (current_section == "next steps" || current_section == "next_steps") {
                state.next_steps.push_back(val);
            } else if (current_section == "context refs" || current_section == "context_refs") {
                state.context_refs.push_back(val);
            }
        }
    }

    std::stringstream sum_ss;
    for (size_t i = 0; i < summary_lines.size(); ++i) {
        sum_ss << summary_lines[i] << (i + 1 < summary_lines.size() ? "\n" : "");
    }
    state.summary = trim(sum_ss.str());
    if (state.summary == "-") state.summary.clear();

    return state;
}

nlohmann::json HandoffState::to_json() const {
    nlohmann::json j = nlohmann::json::object();
    j["task"] = task;
    j["from_agent"] = from_agent;
    j["to_agent"] = to_agent;
    j["summary"] = summary;
    j["decisions"] = decisions;
    j["important_files"] = important_files;
    j["errors"] = errors;
    j["next_steps"] = next_steps;
    j["context_refs"] = context_refs;
    j["metadata"] = metadata.is_null() ? nlohmann::json::object() : metadata;
    return j;
}

HandoffState HandoffState::from_json(const nlohmann::json& j) {
    HandoffState state;
    state.task = j.value("task", "");
    state.from_agent = j.value("from_agent", "");
    state.to_agent = j.value("to_agent", "");
    state.summary = j.value("summary", "");
    state.decisions = j.value("decisions", std::vector<std::string>{});
    state.important_files = j.value("important_files", std::vector<std::string>{});
    state.errors = j.value("errors", std::vector<std::string>{});
    state.next_steps = j.value("next_steps", std::vector<std::string>{});
    state.context_refs = j.value("context_refs", std::vector<std::string>{});
    state.metadata = j.value("metadata", nlohmann::json::object());
    return state;
}

nlohmann::json TraceStep::to_json() const {
    nlohmann::json j = nlohmann::json::object();
    j["name"] = name;
    j["agent"] = agent;
    j["task"] = task;
    j["mode"] = mode;
    j["success"] = success;
    j["output"] = output;
    j["tool_results"] = tool_results;
    j["events"] = events;
    j["handoff"] = handoff;
    j["metadata"] = metadata.is_null() ? nlohmann::json::object() : metadata;
    return j;
}

TraceStep TraceStep::from_json(const nlohmann::json& j) {
    TraceStep step;
    step.name = j.value("name", "");
    step.agent = j.value("agent", "");
    step.task = j.value("task", "");
    step.mode = j.value("mode", "");
    step.success = j.value("success", true);
    step.output = j.value("output", "");
    step.tool_results = j.value("tool_results", std::vector<nlohmann::json>{});
    step.events = j.value("events", std::vector<nlohmann::json>{});
    step.handoff = j.value("handoff", nlohmann::json());
    step.metadata = j.value("metadata", nlohmann::json::object());
    return step;
}

nlohmann::json RunTrace::to_json() const {
    nlohmann::json j = nlohmann::json::object();
    j["run_id"] = run_id;
    j["name"] = name;
    j["success"] = success;
    j["final_output"] = final_output;
    
    nlohmann::json steps_json = nlohmann::json::array();
    for (const auto& step : steps) {
        steps_json.push_back(step.to_json());
    }
    j["steps"] = steps_json;

    nlohmann::json handoffs_json = nlohmann::json::array();
    for (const auto& h : handoffs) {
        handoffs_json.push_back(h.to_json());
    }
    j["handoffs"] = handoffs_json;

    j["metadata"] = metadata.is_null() ? nlohmann::json::object() : metadata;
    return j;
}

RunTrace RunTrace::from_json(const nlohmann::json& j) {
    RunTrace trace;
    trace.run_id = j.value("run_id", "");
    trace.name = j.value("name", "");
    trace.success = j.value("success", true);
    trace.final_output = j.value("final_output", "");
    
    if (j.contains("steps") && j["steps"].is_array()) {
        for (const auto& s : j["steps"]) {
            trace.steps.push_back(TraceStep::from_json(s));
        }
    }
    if (j.contains("handoffs") && j["handoffs"].is_array()) {
        for (const auto& h : j["handoffs"]) {
            trace.handoffs.push_back(HandoffState::from_json(h));
        }
    }
    trace.metadata = j.value("metadata", nlohmann::json::object());
    return trace;
}

std::string RunTrace::to_timeline() const {
    std::stringstream ss;
    ss << "# Execution Timeline: " << name << " (Run ID: " << run_id << ")\n";
    ss << "- Success: " << (success ? "true" : "false") << "\n";
    ss << "- Total Steps: " << steps.size() << "\n";
    ss << "- Total Handoffs: " << handoffs.size() << "\n\n";
    ss << "## Timeline\n";

    for (size_t i = 0; i < steps.size(); ++i) {
        const auto& step = steps[i];
        ss << (i + 1) << ". [" << (step.agent.empty() ? "Unknown" : step.agent) << "] -> Task: " << step.task << "\n";
        ss << "   - Mode: " << (step.mode.empty() ? "default" : step.mode) << "\n";
        ss << "   - Success: " << (step.success ? "true" : "false") << "\n";
        ss << "   - Tools Used: " << step.tool_results.size() << "\n";
        if (!step.output.empty()) {
            std::string cleaned_output = step.output;
            std::replace(cleaned_output.begin(), cleaned_output.end(), '\n', ' ');
            std::string preview = cleaned_output.size() > 60 ? cleaned_output.substr(0, 60) + "..." : cleaned_output;
            ss << "   - Output Preview: " << preview << "\n";
        }
        if (step.handoff.is_object() && !step.handoff.is_null()) {
            std::string from = step.handoff.value("from_agent", "");
            std::string to = step.handoff.value("to_agent", "");
            ss << "   - [Handoff] -> " << from << " to " << to << "\n";
        }
    }

    return ss.str();
}

nlohmann::json ContextDocument::to_json() const {
    nlohmann::json j = nlohmann::json::object();
    j["path"] = path;
    j["content"] = content;
    j["summary"] = summary;
    j["metadata"] = metadata.is_null() ? nlohmann::json::object() : metadata;
    return j;
}

ContextDocument ContextDocument::from_json(const nlohmann::json& j) {
    ContextDocument doc;
    doc.path = j.value("path", "");
    doc.content = j.value("content", "");
    doc.summary = j.value("summary", "");
    doc.metadata = j.value("metadata", nlohmann::json::object());
    return doc;
}

nlohmann::json ContextPack::to_json() const {
    nlohmann::json j = nlohmann::json::object();
    j["query"] = query;
    nlohmann::json docs = nlohmann::json::array();
    for (const auto& doc : documents) {
        docs.push_back(doc.to_json());
    }
    j["documents"] = docs;
    j["memories"] = memories;
    j["summary"] = summary;
    j["metadata"] = metadata.is_null() ? nlohmann::json::object() : metadata;
    return j;
}

ContextPack ContextPack::from_json(const nlohmann::json& j) {
    ContextPack pack;
    pack.query = j.value("query", "");
    if (j.contains("documents") && j["documents"].is_array()) {
        for (const auto& d : j["documents"]) {
            pack.documents.push_back(ContextDocument::from_json(d));
        }
    }
    pack.memories = j.value("memories", std::vector<nlohmann::json>{});
    pack.summary = j.value("summary", "");
    pack.metadata = j.value("metadata", nlohmann::json::object());
    return pack;
}

nlohmann::json ContextRunResult::to_json() const {
    nlohmann::json j = nlohmann::json::object();
    j["final_output"] = final_output;
    j["context_used"] = context_used;
    j["memories_used"] = memories_used;
    j["success"] = success;
    return j;
}

ContextRunResult ContextRunResult::from_json(const nlohmann::json& j) {
    ContextRunResult res;
    res.final_output = j.value("final_output", "");
    res.context_used = j.value("context_used", nlohmann::json());
    res.memories_used = j.value("memories_used", std::vector<nlohmann::json>{});
    res.success = j.value("success", true);
    return res;
}

} // namespace handoffkit
