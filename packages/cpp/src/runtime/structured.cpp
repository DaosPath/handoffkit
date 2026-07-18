#include <handoffkit/runtime/structured.hpp>
#include <handoffkit/util/text.hpp>

#include <cctype>
#include <sstream>

namespace handoffkit {
namespace {

std::string strip_code_fences(std::string_view text) {
    std::string s = text::trim(text);
    if (text::starts_with(s, "```")) {
        auto first_nl = s.find('\n');
        if (first_nl != std::string::npos) {
            s = s.substr(first_nl + 1);
        }
        auto end = s.rfind("```");
        if (end != std::string::npos) {
            s = s.substr(0, end);
        }
    }
    return text::trim(s);
}

std::string extract_balanced_object(std::string_view text) {
    const auto start = text.find('{');
    if (start == std::string::npos) return {};
    int depth = 0;
    bool in_str = false;
    bool escape = false;
    for (std::size_t i = start; i < text.size(); ++i) {
        const char ch = text[i];
        if (in_str) {
            if (escape) {
                escape = false;
            } else if (ch == '\\') {
                escape = true;
            } else if (ch == '"') {
                in_str = false;
            }
            continue;
        }
        if (ch == '"') {
            in_str = true;
        } else if (ch == '{') {
            ++depth;
        } else if (ch == '}') {
            --depth;
            if (depth == 0) {
                return std::string(text.substr(start, i - start + 1));
            }
        }
    }
    return {};
}

std::string repair_common_issues(std::string s) {
    // trailing commas before } or ]
    std::string out;
    out.reserve(s.size());
    for (std::size_t i = 0; i < s.size(); ++i) {
        if (s[i] == ',') {
            std::size_t j = i + 1;
            while (j < s.size() && std::isspace(static_cast<unsigned char>(s[j]))) ++j;
            if (j < s.size() && (s[j] == '}' || s[j] == ']')) {
                continue;  // drop trailing comma
            }
        }
        out.push_back(s[i]);
    }
    // single quotes -> double quotes when looks like JSON-ish
    bool maybe_single = out.find('\'') != std::string::npos && out.find('"') == std::string::npos;
    if (maybe_single) {
        for (char& ch : out) {
            if (ch == '\'') ch = '"';
        }
    }
    return out;
}

std::string type_name_of(const nlohmann::json& v) {
    if (v.is_string()) return "string";
    if (v.is_number()) return "number";
    if (v.is_boolean()) return "boolean";
    if (v.is_array()) return "array";
    if (v.is_object()) return "object";
    if (v.is_null()) return "null";
    return "unknown";
}

}  // namespace

nlohmann::json StructuredParseResult::to_json() const {
    return nlohmann::json{
        {"success", success},
        {"value", value},
        {"repairs", repairs},
        {"errors", errors},
    };
}

Result<nlohmann::json> extract_json_object(std::string_view text) {
    auto stripped = strip_code_fences(text);
    auto obj = extract_balanced_object(stripped);
    if (obj.empty()) {
        // try whole string
        obj = stripped;
    }
    try {
        auto parsed = nlohmann::json::parse(obj);
        if (!parsed.is_object()) {
            return Error::parse_error("extracted JSON is not an object");
        }
        return Result<nlohmann::json>::success(std::move(parsed));
    } catch (const std::exception& ex) {
        return Error::parse_error(std::string("JSON parse failed: ") + ex.what());
    }
}

Result<nlohmann::json> repair_json_text(std::string_view text) {
    auto stripped = strip_code_fences(text);
    auto candidate = extract_balanced_object(stripped);
    if (candidate.empty()) candidate = stripped;
    candidate = repair_common_issues(std::move(candidate));
    try {
        auto parsed = nlohmann::json::parse(candidate);
        return Result<nlohmann::json>::success(std::move(parsed));
    } catch (const std::exception& ex) {
        return Error::parse_error(std::string("repair parse failed: ") + ex.what());
    }
}

StructuredParseResult validate_structured(
    const nlohmann::json& value,
    const StructuredSchema& schema
) {
    StructuredParseResult result;
    result.value = value;
    if (!value.is_object()) {
        result.errors.push_back("value must be a JSON object");
        result.success = false;
        return result;
    }
    for (const auto& field : schema.required_fields) {
        if (!value.contains(field)) {
            result.errors.push_back("missing required field: " + field);
        }
    }
    if (schema.field_types.is_object()) {
        for (auto it = schema.field_types.begin(); it != schema.field_types.end(); ++it) {
            if (!value.contains(it.key())) continue;
            const std::string expected = it.value().get<std::string>();
            const std::string actual = type_name_of(value.at(it.key()));
            if (expected == "number" && actual == "number") continue;
            if (expected != actual) {
                result.errors.push_back(
                    "field " + it.key() + " expected " + expected + " got " + actual
                );
            }
        }
    }
    result.success = result.errors.empty();
    return result;
}

StructuredParseResult parse_agent_structured(
    std::string_view text,
    const StructuredSchema& schema,
    bool allow_repair
) {
    StructuredParseResult result;
    auto extracted = extract_json_object(text);
    if (!extracted) {
        if (!allow_repair) {
            result.errors.push_back(extracted.error().message);
            return result;
        }
        auto repaired = repair_json_text(text);
        if (!repaired) {
            result.errors.push_back(extracted.error().message);
            result.errors.push_back(repaired.error().message);
            return result;
        }
        result.repairs.push_back("applied_common_json_repairs");
        result = validate_structured(repaired.value(), schema);
        return result;
    }
    result = validate_structured(extracted.value(), schema);
    return result;
}

StructuredSchema rankings_schema() {
    return StructuredSchema{
        "rankings",
        {"rankings"},
        {{"rankings", "array"}, {"notes", "string"}},
    };
}

StructuredSchema action_plan_schema() {
    return StructuredSchema{
        "action_plan",
        {"goal", "steps", "owners"},
        {{"goal", "string"}, {"steps", "array"}, {"owners", "array"}, {"risks", "array"}},
    };
}

StructuredSchema incident_update_schema() {
    return StructuredSchema{
        "incident_update",
        {"severity", "status", "summary"},
        {{"severity", "string"}, {"status", "string"}, {"summary", "string"}, {"next_update_minutes", "number"}},
    };
}

StructuredSchema review_verdict_schema() {
    return StructuredSchema{
        "review_verdict",
        {"verdict", "blocking_issues"},
        {{"verdict", "string"}, {"blocking_issues", "array"}, {"nits", "array"}},
    };
}

std::string structured_prompt_suffix(const StructuredSchema& schema) {
    std::ostringstream ss;
    ss << "\n\nRespond with a JSON object named schema '" << schema.name << "' requiring fields: ";
    for (std::size_t i = 0; i < schema.required_fields.size(); ++i) {
        if (i) ss << ", ";
        ss << schema.required_fields[i];
    }
    ss << ".\nExample shape: {\n";
    for (const auto& f : schema.required_fields) {
        ss << "  \"" << f << "\": ...\n";
    }
    ss << "}\n";
    return ss.str();
}

}  // namespace handoffkit
