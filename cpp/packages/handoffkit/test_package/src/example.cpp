#include <handoffkit/handoffkit_core.hpp>

#include <iostream>

int main() {
    using namespace handoffkit;

    HandoffState state;
    state.task = "Validate Conan package";
    state.from_agent = "Packager";
    state.to_agent = "Consumer";
    state.summary = "Package installs and links.";

    Agent agent("Consumer", "Uses handoffkit", EchoProvider().as_any());
    auto out = agent.run(state.task, RunOptions{.handoff = &state});
    if (!out) {
        std::cerr << out.error().message << "\n";
        return 1;
    }

    // Prefer core target surface after install
    ToolRegistry reg;
    register_default_safe_tools(reg);
    if (reg.contains("shell")) {
        std::cerr << "shell must not be in default safe tools\n";
        return 1;
    }

    std::cout << "handoffkit " << version() << " ok\n";
    std::cout << out.value() << "\n";
    return 0;
}
