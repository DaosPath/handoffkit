#include <handoffkit/browser/util.hpp>
#include <handoffkit/browser/web_types.hpp>

#include <cctype>
#include <sstream>

namespace handoffkit {
namespace browser {

SoftBlockResult detect_soft_block(std::string_view body, int status) {
    SoftBlockResult out;
    std::string text(body.substr(0, body.size() > 8000 ? 8000 : body.size()));
    for (char& c : text) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));

    auto has = [&](const char* needle) { return text.find(needle) != std::string::npos; };

    if (status == 403 || status == 429 || status == 503) {
        if (has("cf-browser-verification") || has("just a moment") || has("attention required") ||
            has("cloudflare") || has("access denied") || has("captcha") || has("enable javascript")) {
            out.blocked = true;
            out.reason = "soft_block_status_" + std::to_string(status);
            return out;
        }
        if (status == 403 || status == 429) {
            out.blocked = true;
            out.reason = "http_" + std::to_string(status);
            return out;
        }
    }
    if (has("cf-browser-verification") || has("checking your browser") ||
        (has("captcha") && has("cloudflare"))) {
        out.blocked = true;
        out.reason = "challenge_page";
    }
    return out;
}

std::string smart_truncate(std::string_view markdown, int max_chars) {
    if (max_chars <= 0 || static_cast<int>(markdown.size()) <= max_chars) {
        return std::string(markdown);
    }
    std::string cut(markdown.substr(0, static_cast<std::size_t>(max_chars)));
    auto last_h2 = cut.rfind("\n## ");
    auto last_h1 = cut.rfind("\n# ");
    auto last_heading = std::max(last_h2 == std::string::npos ? 0 : last_h2,
                                 last_h1 == std::string::npos ? 0 : last_h1);
    auto last_para = cut.rfind("\n\n");
    std::size_t end = static_cast<std::size_t>(max_chars);
    if (last_heading > static_cast<std::size_t>(max_chars) / 2) end = last_heading;
    else if (last_para != std::string::npos && last_para > static_cast<std::size_t>(max_chars) * 3 / 5) {
        end = last_para;
    }
    while (!cut.empty() && end < cut.size() && (cut[end - 1] == ' ' || cut[end - 1] == '\n')) --end;
    return cut.substr(0, end) + "\n\n...[truncated]\n";
}

std::string canonical_url(std::string_view url) {
    auto parts = parse_url(url);
    if (!parts.valid) return std::string(url);
    std::ostringstream ss;
    ss << (parts.scheme.empty() ? "https" : parts.scheme) << "://" << parts.host;
    if (parts.path.empty()) ss << "/";
    else ss << parts.path;
    // Drop fragments and tracking params (utm_*, click ids, ref, …).
    std::string q = parts.query;
    const auto hash = q.find('#');
    if (hash != std::string::npos) q.erase(hash);
    static const char* kTracking[] = {
        "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
        "fbclid", "gclid", "gbraid", "wbraid", "msclkid", "yclid",
        "mc_cid", "mc_eid", "igshid", "_hsenc", "_hsmi", "ref", "ref_src",
    };
    if (!q.empty()) {
        std::string filtered;
        std::size_t start = 0;
        while (start <= q.size()) {
            const auto amp = q.find('&', start);
            const std::string piece = q.substr(start, amp == std::string::npos ? std::string::npos : amp - start);
            const auto eq = piece.find('=');
            std::string key = eq == std::string::npos ? piece : piece.substr(0, eq);
            for (char& c : key) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            bool tracking = key.rfind("utm_", 0) == 0;
            for (const char* known : kTracking) {
                if (key == known) { tracking = true; break; }
            }
            if (!tracking) {
                if (!filtered.empty()) filtered.push_back('&');
                filtered += piece;
            }
            if (amp == std::string::npos) break;
            start = amp + 1;
        }
        if (!filtered.empty()) ss << "?" << filtered;
    }
    std::string out = ss.str();
    if (out.size() > 1 && out.back() == '/' && parts.path != "/") out.pop_back();
    return out;
}

}  // namespace browser
}  // namespace handoffkit
