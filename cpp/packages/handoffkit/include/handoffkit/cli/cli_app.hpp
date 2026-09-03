#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace handoffkit {
namespace cli {

struct CliResult {
    int exit_code = 0;
    std::string stdout_text;
    std::string stderr_text;
};

/// Parse argv-style args (without program name) and run a CLI command.
/// This is the library entry point CTest and `main` both call.
[[nodiscard]] CliResult run_cli(const std::vector<std::string>& args);

[[nodiscard]] std::string help_text();
[[nodiscard]] std::string version_text();

/// Known top-level commands (for tests/docs).
[[nodiscard]] std::vector<std::string> command_names();

}  // namespace cli
}  // namespace handoffkit
