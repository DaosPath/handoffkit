#pragma once

#include <handoffkit/error.hpp>

#include <nlohmann/json.hpp>

#include <exception>
#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {
namespace browser {
namespace core {

inline constexpr std::string_view kContractVersion = "1.20.0-alpha.1";
inline constexpr std::string_view kContractFormat = "handoffkit.browser.core";

class CoreError : public std::exception {
public:
    CoreError(std::string code, std::string message)
        : code_(std::move(code)), message_(std::move(message)) {}
    [[nodiscard]] const char* what() const noexcept override { return message_.c_str(); }
    [[nodiscard]] const std::string& code() const noexcept { return code_; }

private:
    std::string code_;
    std::string message_;
};

[[nodiscard]] nlohmann::json parse_core_model(std::string_view name, const nlohmann::json& input);
[[nodiscard]] bool is_known_model(std::string_view name);
[[nodiscard]] nlohmann::json redact_sensitive(const nlohmann::json& value, int depth = 0);
[[nodiscard]] void reject_public_bind(const nlohmann::json& policy, std::string_view host);
[[nodiscard]] nlohmann::json classify_network_target(std::string_view url);
[[nodiscard]] void assert_network_url(const nlohmann::json& policy, std::string_view url);
[[nodiscard]] void assert_filesystem(const nlohmann::json& policy, std::string_view operation);

}  // namespace core
}  // namespace browser
}  // namespace handoffkit
