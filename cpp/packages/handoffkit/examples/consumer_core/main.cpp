// Minimal out-of-tree consumer linked against handoffkit::core only.
// No demos/fusion symbols.

#include <handoffkit/handoffkit_core.hpp>

#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

int main(int argc, char** argv) {
    using namespace handoffkit;

    std::filesystem::path out_dir = "runs/consumer_core";
    if (argc > 1) {
        out_dir = argv[1];
    }

    std::vector<Agent> agents;
    agents.emplace_back("Architect", "Designs the approach", EchoProvider("echo-core").as_any());
    agents.emplace_back("Coder", "Implements the design", EchoProvider("echo-core").as_any());

    Team team(std::move(agents), HandoffProtocol(ProtocolMode::HybridState));
    auto result = team.run("Prove handoffkit::core install works offline");
    if (!result) {
        std::cerr << "team failed: " << result.error().message << "\n";
        return 1;
    }

    // Usage metrics on the provider path (core surface)
    auto probe = EchoProvider("usage-probe").as_any();
    auto gen = probe.generate("consumer probe");
    if (!gen || !probe.last_usage().success) {
        std::cerr << "usage probe failed\n";
        return 1;
    }
    const auto usage = probe.last_usage().to_json();
    if (!usage.contains("prompt_chars") || !usage.contains("completion_chars")) {
        std::cerr << "usage json missing snake_case fields\n";
        return 1;
    }

    // Safe tools: no shell by default
    ToolRegistry reg;
    register_default_safe_tools(reg);
    if (reg.contains("shell")) {
        std::cerr << "default safe registry must not include shell\n";
        return 1;
    }

    auto trace = build_run_trace("consumer-core-1", "consumer_core", result.value());
    auto written = write_report_files(out_dir.string(), "report", trace);
    if (!written) {
        std::cerr << "write_report_files failed: " << written.error().message << "\n";
        return 1;
    }

    std::cout << "handoffkit " << version() << " consumer_core OK\n"
              << "target=handoffkit::core\n"
              << "final_output_chars=" << result.value().final_output.size() << "\n"
              << "usage.prompt_chars=" << usage["prompt_chars"] << "\n"
              << "usage.completion_chars=" << usage["completion_chars"] << "\n"
              << "safe_tools=" << reg.names().size() << " (no shell)\n"
              << "reports=" << out_dir.string() << "\n";
    return 0;
}
