#include <handoffkit/handoffkit.hpp>

#include <iostream>

int main() {
    using namespace handoffkit;

    std::vector<Agent> agents;
    agents.emplace_back("Architect", "Designs the approach", EchoProvider().as_any());
    agents.emplace_back("Coder", "Implements the design", EchoProvider().as_any());
    agents.emplace_back("Reviewer", "Reviews the implementation", EchoProvider().as_any());

    Team team(std::move(agents), HandoffProtocol(ProtocolMode::HybridState));
    auto result = team.run("Ship a native C++ handoff runtime");
    if (!result) {
        std::cerr << "Team failed: " << result.error().message << "\n";
        return 1;
    }

    std::cout << "HandoffKit " << version() << " team run\n";
    std::cout << "Final: " << result.value().final_output << "\n\n";
    std::cout << "Handoffs:\n";
    for (const auto& handoff : result.value().handoffs) {
        std::cout << handoff.to_markdown() << "\n---\n";
    }
    return 0;
}
