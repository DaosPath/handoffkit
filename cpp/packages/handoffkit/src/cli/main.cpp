#include <handoffkit/cli/cli_app.hpp>

#include <iostream>
#include <string>
#include <vector>

int main(int argc, char** argv) {
    std::vector<std::string> args;
    args.reserve(static_cast<std::size_t>(argc > 0 ? argc - 1 : 0));
    for (int i = 1; i < argc; ++i) {
        args.emplace_back(argv[i]);
    }
    auto result = handoffkit::cli::run_cli(args);
    if (!result.stdout_text.empty()) {
        std::cout << result.stdout_text;
        if (result.stdout_text.back() != '\n') {
            std::cout << '\n';
        }
    }
    if (!result.stderr_text.empty()) {
        std::cerr << result.stderr_text;
        if (result.stderr_text.back() != '\n') {
            std::cerr << '\n';
        }
    }
    return result.exit_code;
}
