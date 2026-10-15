#include <handoffkit/browser/core.hpp>

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <regex>
#include <string>
#include <unordered_set>

namespace handoffkit {
namespace browser {
namespace core {
namespace {

const std::unordered_set<std::string> kErrorCodes{
    "", "invalid_request", "unauthorized", "replay_detected", "capability_denied", "policy_denied",
    "provider_unavailable", "provider_challenge", "timeout", "cancelled", "interrupted", "not_found",
    "index_corrupt", "index_unavailable", "public_bind_rejected", "profile_denied", "javascript_denied",
    "download_quarantined", "engine_crash", "engine_unsupported", "strict_provider_rejected",
    "user_browser_bridge_required", "default_browser_bridge_required", "query_required", "no_results",
    "robots_denied", "rate_limited", "unsupported_provider",
    "artifact_write_failed", "artifact_integrity_failed", "download_too_large",
};
const std::unordered_set<std::string> kProducts{"core", "lite", "real"};
const std::unordered_set<std::string> kSession{"pending", "starting", "ready", "running", "paused", "interrupted", "closed"};
const std::unordered_set<std::string> kClaims{"supported", "derived", "not_found"};
const std::unordered_set<std::string> kStages{
    "plan", "search", "select", "fetch", "extract", "ground", "recover", "complete", "failed", "cancelled",
};
const std::unordered_set<std::string> kCommands{
    "session.start", "session.close", "session.status", "session.pause", "session.resume", "session.retry",
    "navigate", "back", "forward", "reload", "wait", "snapshot.dom",
    "snapshot.ax", "locate", "click", "type", "select", "press", "markdown", "screenshot", "pdf",
    "download", "cancel", "evaluate",
};
const std::unordered_set<std::string> kEvents{
    "session.started", "session.closed", "session.interrupted", "session.status", "session.paused",
    "session.resumed", "session.retry", "navigated", "wait.done", "snapshot",
    "located", "action.done", "network", "console", "page.error", "markdown", "screenshot", "pdf",
    "download", "cancelled", "error", "research.progress", "capability.updated",
};

std::string as_text(const nlohmann::json& value, const char* fallback = "") {
    if (value.is_null() || !value.is_string()) {
        if (value.is_number() || value.is_boolean()) return value.dump();
        return fallback;
    }
    return value.get<std::string>();
}

std::string field_text(const nlohmann::json& obj, const char* key, const char* fallback = "") {
    if (!obj.is_object() || !obj.contains(key)) return fallback;
    return as_text(obj.at(key), fallback);
}

bool field_bool(const nlohmann::json& obj, const char* key, bool fallback = false) {
    if (!obj.is_object() || !obj.contains(key) || obj.at(key).is_null()) return fallback;
    if (obj.at(key).is_boolean()) return obj.at(key).get<bool>();
    return fallback;
}

int field_int(const nlohmann::json& obj, const char* key, int fallback = 0) {
    if (!obj.is_object() || !obj.contains(key) || obj.at(key).is_null()) return fallback;
    if (obj.at(key).is_number_integer()) return obj.at(key).get<int>();
    if (obj.at(key).is_number()) return static_cast<int>(obj.at(key).get<double>());
    return fallback;
}

nlohmann::json field_obj(const nlohmann::json& obj, const char* key) {
    if (!obj.is_object() || !obj.contains(key) || !obj.at(key).is_object()) return nlohmann::json::object();
    return obj.at(key);
}

nlohmann::json field_array(const nlohmann::json& obj, const char* key) {
    if (!obj.is_object() || !obj.contains(key) || !obj.at(key).is_array()) return nlohmann::json::array();
    return obj.at(key);
}

std::vector<std::string> field_str_list(const nlohmann::json& obj, const char* key) {
    std::vector<std::string> out;
    for (const auto& item : field_array(obj, key)) out.push_back(as_text(item));
    return out;
}

void require_code(const std::string& code) {
    if (!kErrorCodes.count(code)) throw CoreError("invalid_request", "Unknown browser error code: " + code);
}

void require_rfc3339(const std::string& value, const char* field) {
    if (value.empty()) return;
    if (value.size() < 20 || value[4] != '-' || value[7] != '-' || value[10] != 'T') {
        throw CoreError("invalid_request", std::string(field) + " must be RFC 3339");
    }
}

void require_one(const std::string& value, const std::unordered_set<std::string>& allowed, const char* field) {
    if (!allowed.count(value)) throw CoreError("invalid_request", std::string("Invalid ") + field + ": " + value);
}

bool sha256_ok(const std::string& value) {
    static const std::regex re("^[a-f0-9]{64}$");
    return std::regex_match(value, re);
}

nlohmann::json provenance(const nlohmann::json& data) {
    const auto source = data.is_object() ? data : nlohmann::json::object();
    return {
        {"provider", field_text(source, "provider")},
        {"method", field_text(source, "method")},
        {"redirects", field_int(source, "redirects", 0)},
        {"status", field_int(source, "status", 0)},
    };
}

nlohmann::json parse_error(const nlohmann::json& input) {
    const auto data = input.is_object() ? input : nlohmann::json::object();
    const auto code = field_text(data, "code");
    require_code(code);
    return {
        {"contract_version", field_text(data, "contract_version", "1.20.0-alpha.1")},
        {"code", code},
        {"message", field_text(data, "message")},
        {"retryable", field_bool(data, "retryable", false)},
        {"details", field_obj(data, "details")},
        {"request_id", field_text(data, "request_id")},
        {"command_id", field_text(data, "command_id")},
        {"session_id", field_text(data, "session_id")},
        {"occurred_at", field_text(data, "occurred_at")},
    };
}

nlohmann::json parse_policy(const nlohmann::json& input);

nlohmann::json parse_capabilities(const nlohmann::json& input) {
    const auto data = input.is_object() ? input : nlohmann::json::object();
    auto product = field_text(data, "product", "core");
    require_one(product, kProducts, "product");
    nlohmann::json out = {
        {"contract_version", field_text(data, "contract_version", "1.20.0-alpha.1")},
        {"product", product},
        {"engine", field_text(data, "engine")},
        {"engine_ready", field_bool(data, "engine_ready", false)},
        {"search_providers", field_array(data, "search_providers")},
        {"operations", field_array(data, "operations")},
        {"javascript", field_bool(data, "javascript", false)},
        {"screenshots", field_bool(data, "screenshots", false)},
        {"pdf", field_bool(data, "pdf", false)},
        {"downloads", field_bool(data, "downloads", false)},
        {"persistent_profile", field_bool(data, "persistent_profile", false)},
        {"local_index", field_bool(data, "local_index", false)},
        {"probed_at", field_text(data, "probed_at")},
        {"probe_results", field_array(data, "probe_results")},
    };
    if (product != "real") {
        out["javascript"] = false;
        out["screenshots"] = false;
        out["pdf"] = false;
        out["downloads"] = false;
        out["persistent_profile"] = false;
        out["engine_ready"] = false;
        out["engine"] = "";
        out["probed_at"] = "";
        out["probe_results"] = nlohmann::json::array();
    }
    if (product == "core") out["local_index"] = false;
    if (out["engine_ready"].get<bool>() && as_text(out["probed_at"]).empty()) {
        throw CoreError("invalid_request", "engine_ready requires a completed probe timestamp");
    }
    return out;
}

nlohmann::json parse_policy(const nlohmann::json& input) {
    const auto data = input.is_object() ? input : nlohmann::json::object();
    const auto network_in = field_obj(data, "network");
    const auto filesystem = field_obj(data, "filesystem");
    const auto javascript = field_obj(data, "javascript");
    const auto credentials = field_obj(data, "credentials");
    const auto index = field_obj(data, "index");
    const auto bind = field_obj(data, "bind");
    if (field_bool(credentials, "reuse_user_profile", false) || field_bool(credentials, "share_cookies", false)) {
        throw CoreError("profile_denied", "Sharing cookies or reusing the operator browser profile is forbidden");
    }
    nlohmann::json network = {
        {"allow_loopback", field_bool(network_in, "allow_loopback", false)},
        {"allow_private", field_bool(network_in, "allow_private", false)},
        {"allow_public", field_bool(network_in, "allow_public", true)},
        {"allow_hosts", field_array(network_in, "allow_hosts")},
        {"deny_hosts", field_array(network_in, "deny_hosts")},
        {"max_redirects", field_int(network_in, "max_redirects", 5)},
        {"max_body_bytes", field_int(network_in, "max_body_bytes", 2 * 1024 * 1024)},
        {"max_decompress_bytes", field_int(network_in, "max_decompress_bytes", 8 * 1024 * 1024)},
        {"timeout_ms", field_int(network_in, "timeout_ms", 15000)},
        {"respect_robots", field_bool(network_in, "respect_robots", true)},
    };
    return {
        {"contract_version", field_text(data, "contract_version", "1.20.0-alpha.1")},
        {"network", network},
        {"filesystem", {
            {"allow_read", field_bool(filesystem, "allow_read", false)},
            {"allow_write", field_bool(filesystem, "allow_write", false)},
            {"download_dir", field_text(filesystem, "download_dir")},
            {"quarantine_downloads", field_bool(filesystem, "quarantine_downloads", true)},
            {"max_download_bytes", field_int(filesystem, "max_download_bytes", 50 * 1024 * 1024)},
        }},
        {"javascript", {{"allow_evaluate", field_bool(javascript, "allow_evaluate", false)}}},
        {"credentials", {
            {"share_cookies", field_bool(credentials, "share_cookies", false)},
            {"persistent_profile", field_bool(credentials, "persistent_profile", false)},
            {"profile_dir", field_text(credentials, "profile_dir")},
            {"reuse_user_profile", false},
        }},
        {"index", {
            {"enabled", field_bool(index, "enabled", false)},
            {"max_documents", field_int(index, "max_documents", 10000)},
            {"max_bytes", field_int(index, "max_bytes", 256 * 1024 * 1024)},
            {"retention_days", field_int(index, "retention_days", 30)},
            {"max_hosts", field_int(index, "max_hosts", 256)},
        }},
        {"bind", {
            {"allow_public_bind", field_bool(bind, "allow_public_bind", false)},
            {"require_tls", field_bool(bind, "require_tls", true)},
            {"require_mtls", field_bool(bind, "require_mtls", true)},
        }},
    };
}

nlohmann::json parse_hit(const nlohmann::json& input) {
    const auto data = input.is_object() ? input : nlohmann::json::object();
    return {
        {"title", field_text(data, "title")},
        {"url", field_text(data, "url")},
        {"snippet", field_text(data, "snippet")},
        {"score", field_int(data, "score", 0)},
        {"provider", field_text(data, "provider")},
    };
}

nlohmann::json parse_trace(const nlohmann::json& input) {
    const auto data = input.is_object() ? input : nlohmann::json::object();
    auto error_code = field_text(data, "error_code");
    if (!error_code.empty()) require_code(error_code);
    auto fallback = field_text(data, "fallback_reason");
    const bool used = field_bool(data, "used", false);
    const bool attempted = field_bool(data, "attempted", false);
    if (!used && attempted && fallback.empty() && error_code.empty()) fallback = "unspecified_fallback";
    return {
        {"provider", field_text(data, "provider")},
        {"attempted", attempted},
        {"used", used},
        {"result_count", field_int(data, "result_count", 0)},
        {"error_code", error_code},
        {"fallback_reason", fallback},
        {"started_at", field_text(data, "started_at")},
        {"finished_at", field_text(data, "finished_at")},
    };
}

nlohmann::json parse_snapshot(const nlohmann::json& input) {
    const auto data = input.is_object() ? input : nlohmann::json::object();
    auto digest = field_text(data, "sha256");
    std::transform(digest.begin(), digest.end(), digest.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    if (!digest.empty() && !sha256_ok(digest)) {
        throw CoreError("invalid_request", "sha256 must be a 64-character hex digest");
    }
    return {
        {"contract_version", field_text(data, "contract_version", "1.20.0-alpha.1")},
        {"snapshot_id", field_text(data, "snapshot_id")},
        {"request_id", field_text(data, "request_id")},
        {"session_id", field_text(data, "session_id")},
        {"url", field_text(data, "url")},
        {"final_url", field_text(data, "final_url")},
        {"fetched_at", field_text(data, "fetched_at")},
        {"sha256", digest},
        {"content_type", field_text(data, "content_type")},
        {"title", field_text(data, "title")},
        {"markdown", field_text(data, "markdown")},
        {"provenance", provenance(field_obj(data, "provenance"))},
        {"applied_limits", field_obj(data, "applied_limits")},
    };
}

nlohmann::json parse_claim(const nlohmann::json& input) {
    const auto data = input.is_object() ? input : nlohmann::json::object();
    auto status = field_text(data, "status", "not_found");
    require_one(status, kClaims, "status");
    auto quote = field_text(data, "quote");
    auto source_url = field_text(data, "source_url");
    auto derived = field_str_list(data, "derived_from");
    if (status == "supported" && (quote.empty() || source_url.empty())) {
        throw CoreError("invalid_request", "supported claims require a verbatim quote and source URL");
    }
    if (status == "derived" && derived.size() < 2) {
        throw CoreError("invalid_request", "derived claims require two or more compatible claim ids");
    }
    nlohmann::json derived_json = nlohmann::json::array();
    for (const auto& item : derived) derived_json.push_back(item);
    return {
        {"claim_id", field_text(data, "claim_id")},
        {"statement", field_text(data, "statement")},
        {"status", status},
        {"quote", quote},
        {"source_snapshot_id", field_text(data, "source_snapshot_id")},
        {"source_url", source_url},
        {"derived_from", derived_json},
    };
}

nlohmann::json parse_search_result(const nlohmann::json& input) {
    const auto data = input.is_object() ? input : nlohmann::json::object();
    nlohmann::json results = nlohmann::json::array();
    for (const auto& item : field_array(data, "results")) results.push_back(parse_hit(item));
    nlohmann::json traces = nlohmann::json::array();
    for (const auto& item : field_array(data, "provider_trace")) traces.push_back(parse_trace(item));
    auto error_code = field_text(data, "error_code");
    if (!error_code.empty()) require_code(error_code);
    const bool strict = field_bool(data, "strict_provider", false);
    auto used = field_str_list(data, "providers_used");
    auto requested = field_str_list(data, "providers_requested");
    if (strict) {
        bool fallback = false;
        for (const auto& item : traces) {
            if (!as_text(item["fallback_reason"]).empty()) fallback = true;
        }
        bool used_other = false;
        for (const auto& name : used) {
            if (!name.empty() && (requested.empty() || name != requested[0])) used_other = true;
        }
        if (fallback || used_other) throw CoreError("strict_provider_rejected", "strict_provider forbids fallback");
    }
    return {
        {"contract_version", field_text(data, "contract_version", "1.20.0-alpha.1")},
        {"request_id", field_text(data, "request_id")},
        {"success", field_bool(data, "success", false)},
        {"query", field_text(data, "query")},
        {"keywords", field_text(data, "keywords")},
        {"results", results},
        {"count", field_int(data, "count", static_cast<int>(results.size()))},
        {"strict_provider", strict},
        {"providers_requested", field_array(data, "providers_requested")},
        {"providers_used", field_array(data, "providers_used")},
        {"provider_trace", traces},
        {"errors", field_array(data, "errors")},
        {"error_code", error_code},
        {"error", field_text(data, "error")},
    };
}

}  // namespace

nlohmann::json redact_sensitive(const nlohmann::json& value, int depth) {
    if (depth > 8) return value;
    if (value.is_array()) {
        nlohmann::json out = nlohmann::json::array();
        for (const auto& item : value) out.push_back(redact_sensitive(item, depth + 1));
        return out;
    }
    if (!value.is_object()) return value;
    static const std::regex sensitive("(?:cookie|authorization|token|password|secret|api[_-]?key|set-cookie)", std::regex::icase);
    nlohmann::json out = nlohmann::json::object();
    for (auto it = value.begin(); it != value.end(); ++it) {
        out[it.key()] = std::regex_search(it.key(), sensitive) ? nlohmann::json("[redacted]") : redact_sensitive(it.value(), depth + 1);
    }
    return out;
}

void reject_public_bind(const nlohmann::json& policy, std::string_view host) {
    auto parsed = parse_policy(policy);
    std::string value(host);
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    const bool loopback = value == "127.0.0.1" || value == "localhost" || value == "::1";
    const auto bind = parsed["bind"];
    if (!loopback && !bind["allow_public_bind"].get<bool>()) {
        throw CoreError("public_bind_rejected", "Public bind rejected for " + std::string(host));
    }
    if (!loopback && bind["allow_public_bind"].get<bool>() &&
        (!bind["require_tls"].get<bool>() || !bind["require_mtls"].get<bool>())) {
        throw CoreError("public_bind_rejected", "Public bind requires TLS 1.3 and mTLS");
    }
}

std::string classify_host_kind(std::string host) {
    std::transform(host.begin(), host.end(), host.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    if (host.empty()) return "invalid";
    if (host == "localhost" || host == "::1" || host == "0.0.0.0" || host == "::") return "loopback";
    if (host.rfind("127.", 0) == 0) return "loopback";
    int a = -1, b = -1, c = -1, d = -1;
    char extra = 0;
    if (std::sscanf(host.c_str(), "%d.%d.%d.%d%c", &a, &b, &c, &d, &extra) == 4) {
        if (a < 0 || a > 255 || b < 0 || b > 255 || c < 0 || c > 255 || d < 0 || d > 255) return "invalid";
        if (a == 10) return "private";
        if (a == 192 && b == 168) return "private";
        if (a == 172 && b >= 16 && b <= 31) return "private";
        if (a == 169 && b == 254) return "private";
        if (a == 100 && b >= 64 && b <= 127) return "private";
        if (a >= 224) return "private";
        if (a == 0) return "loopback";
        return "public";
    }
    if (host.find(':') != std::string::npos) {
        if (host.rfind("::ffff:", 0) == 0) {
            const std::string mapped = host.substr(7);
            if (mapped.find('.') != std::string::npos) {
                return classify_host_kind(mapped);
            }
            const auto colon = mapped.find(':');
            if (colon != std::string::npos) {
                try {
                    const int hi = std::stoi(mapped.substr(0, colon), nullptr, 16);
                    const int lo = std::stoi(mapped.substr(colon + 1), nullptr, 16);
                    return classify_host_kind(
                        std::to_string((hi >> 8) & 255) + "." + std::to_string(hi & 255) + "." +
                        std::to_string((lo >> 8) & 255) + "." + std::to_string(lo & 255));
                } catch (...) {
                    return "invalid";
                }
            }
        }
        if (host.rfind("fc", 0) == 0 || host.rfind("fd", 0) == 0 || host.rfind("fe80:", 0) == 0 || host.rfind("ff", 0) == 0) return "private";
        return "public";
    }
    return "public";
}

bool host_listed(const std::string& host, const nlohmann::json& patterns) {
    if (!patterns.is_array()) return false;
    for (const auto& item : patterns) {
        std::string needle = as_text(item);
        std::transform(needle.begin(), needle.end(), needle.begin(), [](unsigned char ch) {
            return static_cast<char>(std::tolower(ch));
        });
        if (needle.rfind("*.", 0) == 0) needle = needle.substr(2);
        if (needle.empty()) continue;
        if (host == needle || (host.size() > needle.size() &&
            host.compare(host.size() - needle.size() - 1, needle.size() + 1, "." + needle) == 0)) {
            return true;
        }
    }
    return false;
}

nlohmann::json classify_network_target(std::string_view url) {
    std::string raw(url);
    while (!raw.empty() && (raw.front() == ' ' || raw.front() == '\t')) raw.erase(raw.begin());
    while (!raw.empty() && (raw.back() == ' ' || raw.back() == '\t')) raw.pop_back();
    nlohmann::json invalid = {{"kind", "invalid"}, {"scheme", ""}, {"host", ""}};
    auto colon = raw.find(':');
    if (colon == std::string::npos) return invalid;
    std::string scheme = raw.substr(0, colon);
    std::transform(scheme.begin(), scheme.end(), scheme.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    if (scheme == "file") return {{"kind", "filesystem"}, {"scheme", scheme}, {"host", ""}};
    if (scheme == "data" || scheme == "about" || scheme == "blob") {
        return {{"kind", "local"}, {"scheme", scheme}, {"host", ""}};
    }
    if (scheme != "http" && scheme != "https") {
        return {{"kind", "invalid"}, {"scheme", scheme}, {"host", ""}};
    }
    if (raw.size() < colon + 3 || raw.substr(colon, 3) != "://") return invalid;
    std::string rest = raw.substr(colon + 3);
    auto cut = rest.find_first_of("/?#");
    std::string hostport = cut == std::string::npos ? rest : rest.substr(0, cut);
    auto at = hostport.rfind('@');
    if (at != std::string::npos) hostport = hostport.substr(at + 1);
    std::string host;
    if (!hostport.empty() && hostport.front() == '[') {
        auto rb = hostport.find(']');
        host = rb == std::string::npos ? hostport : hostport.substr(1, rb - 1);
    } else {
        auto port = hostport.rfind(':');
        host = port == std::string::npos ? hostport : hostport.substr(0, port);
    }
    std::transform(host.begin(), host.end(), host.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return {{"kind", classify_host_kind(host)}, {"scheme", scheme}, {"host", host}};
}

void assert_filesystem(const nlohmann::json& policy, std::string_view operation) {
    auto parsed = parse_policy(policy);
    const auto fs = parsed["filesystem"];
    const std::string op(operation);
    if (op == "download") {
        if (fs["quarantine_downloads"].get<bool>()) return;
        if (!fs["allow_write"].get<bool>()) {
            throw CoreError("policy_denied", "Downloads require write permission when quarantine is disabled");
        }
        return;
    }
    if (op == "read" && !fs["allow_read"].get<bool>()) {
        throw CoreError("policy_denied", "Filesystem read is denied");
    }
    if (op == "write" && !fs["allow_write"].get<bool>()) {
        throw CoreError("policy_denied", "Filesystem write is denied");
    }
    if (op != "read" && op != "write" && op != "download") {
        throw CoreError("invalid_request", "Unknown filesystem operation");
    }
}

void assert_network_url(const nlohmann::json& policy, std::string_view url) {
    auto parsed = parse_policy(policy);
    auto target = classify_network_target(url);
    const std::string kind = target["kind"].get<std::string>();
    if (kind == "invalid") throw CoreError("invalid_request", "URL is invalid");
    if (kind == "filesystem") {
        assert_filesystem(parsed, "read");
        return;
    }
    if (kind == "local") return;
    const std::string host = target["host"].get<std::string>();
    const auto network = parsed["network"];
    if (host_listed(host, network["deny_hosts"])) {
        throw CoreError("policy_denied", "Host denied: " + host);
    }
    if (!network["allow_hosts"].empty() && !host_listed(host, network["allow_hosts"])) {
        throw CoreError("policy_denied", "Host not allowlisted: " + host);
    }
    if (kind == "loopback" && !network["allow_loopback"].get<bool>()) {
        throw CoreError("policy_denied", "Loopback navigation is denied");
    }
    if (kind == "private" && !network["allow_private"].get<bool>()) {
        throw CoreError("policy_denied", "Private-network navigation is denied");
    }
    if (kind == "public" && !network["allow_public"].get<bool>()) {
        throw CoreError("policy_denied", "Public-network navigation is denied");
    }
}

bool is_known_model(std::string_view name) {
    static const std::unordered_set<std::string> names{
        "BrowserError", "BrowserCapabilities", "BrowserPolicy", "BrowserSessionRequest",
        "BrowserSessionState", "BrowserCommand", "BrowserEvent", "SearchRequest", "SearchResult",
        "SearchHit", "ResearchJob", "ResearchProgress", "ResearchResult", "ResearchClaim",
        "PageSnapshot", "DocumentRecord", "ProviderTrace",
    };
    return names.count(std::string(name)) == 1;
}

nlohmann::json parse_core_model(std::string_view name, const nlohmann::json& input) {
    const std::string key(name);
    if (key == "BrowserError") return parse_error(input);
    if (key == "BrowserCapabilities") return parse_capabilities(input);
    if (key == "BrowserPolicy") return parse_policy(input);
    if (key == "ProviderTrace") return parse_trace(input);
    if (key == "SearchHit") return parse_hit(input);
    if (key == "PageSnapshot") return parse_snapshot(input);
    if (key == "ResearchClaim") return parse_claim(input);
    if (key == "SearchResult") return parse_search_result(input);
    if (key == "SearchRequest") {
        const auto data = input.is_object() ? input : nlohmann::json::object();
        auto providers = field_array(data, "providers");
        if (providers.empty() && !data.contains("providers")) {
            providers = nlohmann::json::array({"google_browser", "project_index", "google_http", "duckduckgo", "wikipedia"});
        }
        return {
            {"contract_version", field_text(data, "contract_version", "1.20.0-alpha.1")},
            {"request_id", field_text(data, "request_id")},
            {"session_id", field_text(data, "session_id")},
            {"query", field_text(data, "query")},
            {"max_results", field_int(data, "max_results", 8)},
            {"timeout_ms", field_int(data, "timeout_ms", 20000)},
            {"strict_provider", field_bool(data, "strict_provider", false)},
            {"providers", providers},
            {"allow_hosts", field_array(data, "allow_hosts")},
            {"deny_hosts", field_array(data, "deny_hosts")},
            {"issued_at", field_text(data, "issued_at")},
        };
    }
    if (key == "BrowserSessionRequest") {
        const auto data = input.is_object() ? input : nlohmann::json::object();
        auto product = field_text(data, "product", "lite");
        require_one(product, kProducts, "product");
        const bool persistent = field_bool(data, "persistent_profile", false);
        auto profile_dir = field_text(data, "profile_dir");
        if (persistent && profile_dir.empty()) {
            throw CoreError("profile_denied", "Persistent profiles require an explicit isolated profile_dir");
        }
        return {
            {"contract_version", field_text(data, "contract_version", "1.20.0-alpha.1")},
            {"request_id", field_text(data, "request_id")},
            {"session_id", field_text(data, "session_id")},
            {"product", product},
            {"headless", field_bool(data, "headless", true)},
            {"persistent_profile", persistent},
            {"profile_dir", profile_dir},
            {"issued_at", field_text(data, "issued_at")},
            {"deadline_at", field_text(data, "deadline_at")},
            {"policy", parse_policy(field_obj(data, "policy"))},
        };
    }
    if (key == "BrowserSessionState") {
        const auto data = input.is_object() ? input : nlohmann::json::object();
        auto status = field_text(data, "status", "pending");
        require_one(status, kSession, "status");
        auto product = field_text(data, "product", "lite");
        require_one(product, kProducts, "product");
        return {
            {"contract_version", field_text(data, "contract_version", "1.20.0-alpha.1")},
            {"session_id", field_text(data, "session_id")},
            {"request_id", field_text(data, "request_id")},
            {"status", status},
            {"product", product},
            {"engine", field_text(data, "engine")},
            {"headless", field_bool(data, "headless", true)},
            {"persistent_profile", field_bool(data, "persistent_profile", false)},
            {"created_at", field_text(data, "created_at")},
            {"updated_at", field_text(data, "updated_at")},
            {"current_url", field_text(data, "current_url")},
            {"error", parse_error(field_obj(data, "error"))},
        };
    }
    if (key == "BrowserCommand") {
        const auto data = input.is_object() ? input : nlohmann::json::object();
        auto command_id = field_text(data, "command_id");
        if (command_id.empty()) throw CoreError("invalid_request", "command_id is required");
        auto cmd = field_text(data, "name");
        require_one(cmd, kCommands, "name");
        require_rfc3339(field_text(data, "issued_at"), "issued_at");
        require_rfc3339(field_text(data, "deadline_at"), "deadline_at");
        return {
            {"contract_version", field_text(data, "contract_version", "1.20.0-alpha.1")},
            {"command_id", command_id},
            {"request_id", field_text(data, "request_id")},
            {"session_id", field_text(data, "session_id")},
            {"name", cmd},
            {"issued_at", field_text(data, "issued_at")},
            {"deadline_at", field_text(data, "deadline_at")},
            {"idempotency_key", field_text(data, "idempotency_key")},
            {"payload", field_obj(data, "payload")},
        };
    }
    if (key == "BrowserEvent") {
        const auto data = input.is_object() ? input : nlohmann::json::object();
        auto event_id = field_text(data, "event_id");
        if (event_id.empty()) throw CoreError("invalid_request", "event_id is required");
        auto evt = field_text(data, "name");
        require_one(evt, kEvents, "name");
        return {
            {"contract_version", field_text(data, "contract_version", "1.20.0-alpha.1")},
            {"event_id", event_id},
            {"command_id", field_text(data, "command_id")},
            {"request_id", field_text(data, "request_id")},
            {"session_id", field_text(data, "session_id")},
            {"name", evt},
            {"occurred_at", field_text(data, "occurred_at")},
            {"payload", field_obj(data, "payload")},
        };
    }
    if (key == "DocumentRecord") {
        const auto data = input.is_object() ? input : nlohmann::json::object();
        auto digest = field_text(data, "sha256");
        std::transform(digest.begin(), digest.end(), digest.begin(), [](unsigned char c) {
            return static_cast<char>(std::tolower(c));
        });
        if (!digest.empty() && !sha256_ok(digest)) {
            throw CoreError("invalid_request", "sha256 must be a 64-character hex digest");
        }
        return {
            {"contract_version", field_text(data, "contract_version", "1.20.0-alpha.1")},
            {"document_id", field_text(data, "document_id")},
            {"sha256", digest},
            {"url", field_text(data, "url")},
            {"final_url", field_text(data, "final_url")},
            {"title", field_text(data, "title")},
            {"host", field_text(data, "host")},
            {"fetched_at", field_text(data, "fetched_at")},
            {"indexed_at", field_text(data, "indexed_at")},
            {"bytes", field_int(data, "bytes", 0)},
            {"content_type", field_text(data, "content_type")},
            {"provenance", provenance(field_obj(data, "provenance"))},
        };
    }
    if (key == "ResearchJob") {
        const auto data = input.is_object() ? input : nlohmann::json::object();
        return {
            {"contract_version", field_text(data, "contract_version", "1.20.0-alpha.1")},
            {"job_id", field_text(data, "job_id")},
            {"request_id", field_text(data, "request_id")},
            {"session_id", field_text(data, "session_id")},
            {"query", field_text(data, "query")},
            {"status", field_text(data, "status", "running")},
            {"pack_version", field_int(data, "pack_version", 2)},
            {"strict_provider", field_bool(data, "strict_provider", false)},
            {"created_at", field_text(data, "created_at")},
            {"updated_at", field_text(data, "updated_at")},
            {"checkpoint_id", field_text(data, "checkpoint_id")},
            {"idempotency_key", field_text(data, "idempotency_key")},
        };
    }
    if (key == "ResearchProgress") {
        const auto data = input.is_object() ? input : nlohmann::json::object();
        auto stage = field_text(data, "stage", "plan");
        require_one(stage, kStages, "stage");
        return {
            {"contract_version", field_text(data, "contract_version", "1.20.0-alpha.1")},
            {"job_id", field_text(data, "job_id")},
            {"request_id", field_text(data, "request_id")},
            {"stage", stage},
            {"message", field_text(data, "message")},
            {"pages_fetched", field_int(data, "pages_fetched", 0)},
            {"pages_target", field_int(data, "pages_target", 0)},
            {"occurred_at", field_text(data, "occurred_at")},
        };
    }
    if (key == "ResearchResult") {
        const auto data = input.is_object() ? input : nlohmann::json::object();
        nlohmann::json candidates = nlohmann::json::array();
        for (const auto& item : field_array(data, "candidates")) candidates.push_back(parse_hit(item));
        nlohmann::json snapshots = nlohmann::json::array();
        for (const auto& item : field_array(data, "snapshots")) snapshots.push_back(parse_snapshot(item));
        nlohmann::json claims = nlohmann::json::array();
        for (const auto& item : field_array(data, "claims")) claims.push_back(parse_claim(item));
        auto selected = field_str_list(data, "selected_urls");
        std::unordered_set<std::string> allowed(selected.begin(), selected.end());
        for (const auto& snap : snapshots) {
            auto url = as_text(snap["final_url"]);
            if (url.empty()) url = as_text(snap["url"]);
            if (!url.empty()) allowed.insert(url);
        }
        nlohmann::json citations = nlohmann::json::array();
        for (const auto& item : field_array(data, "citations")) {
            auto url = field_text(item, "url");
            if (url.empty()) throw CoreError("invalid_request", "citations cannot be empty");
            if (!allowed.count(url)) throw CoreError("invalid_request", "citation URL was not fetched or selected");
            citations.push_back({{"title", field_text(item, "title")}, {"url", url}});
        }
        return {
            {"contract_version", field_text(data, "contract_version", "1.20.0-alpha.1")},
            {"job_id", field_text(data, "job_id")},
            {"request_id", field_text(data, "request_id")},
            {"pack_version", field_int(data, "pack_version", 2)},
            {"success", field_bool(data, "success", false)},
            {"query", field_text(data, "query")},
            {"queries", field_array(data, "queries")},
            {"candidates", candidates},
            {"selected_urls", field_array(data, "selected_urls")},
            {"snapshots", snapshots},
            {"claims", claims},
            {"contradictions", field_array(data, "contradictions")},
            {"citations", citations},
            {"error", parse_error(field_obj(data, "error"))},
        };
    }
    throw CoreError("invalid_request", "Unknown core model: " + key);
}

}  // namespace core
}  // namespace browser
}  // namespace handoffkit
