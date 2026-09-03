#include <handoffkit/handoffkit_core.hpp>

#include <iostream>

int main() {
    using namespace handoffkit;

    EchoProvider provider("echo");
    Agent agent("Coder", "Implements features carefully", provider.as_any());

    agent.add_tool(Tool(
        "ping",
        "Return pong",
        [](const nlohmann::json&) -> Result<nlohmann::json> {
            return nlohmann::json{{"ok", true}, {"message", "pong"}};
        }
    ));

    auto output = agent.run("Write a small C++ module");
    if (!output) {
        std::cerr << "Agent failed: " << output.error().message << "\n";
        return 1;
    }

    std::cout << "HandoffKit " << version() << "\n";
    std::cout << output.value() << "\n";
    return 0;
}
