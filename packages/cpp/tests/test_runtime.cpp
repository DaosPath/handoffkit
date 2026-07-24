#include <handoffkit/handoffkit_core.hpp>
#include <handoffkit/runtime/fallback_provider.hpp>

#include <atomic>
#include <cassert>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

using namespace handoffkit;

namespace {

void test_version_string() {
    assert(std::string(version()) == "1.14.2");
    std::cout << "test_version_string passed!" << std::endl;
}

void test_result_success_and_failure() {
    Result<int> ok = Result<int>::success(42);
    assert(ok);
    assert(ok.value() == 42);

    Result<int> bad = Error::invalid_argument("nope", "field");
    assert(!bad);
    assert(bad.error().code == ErrorCode::InvalidArgument);
    assert(bad.error().field == "field");

    Result<void> void_ok = Result<void>::success();
    assert(void_ok);
    Result<void> void_bad = Result<void>::failure(Error::parse_error("x"));
    assert(!void_bad);

    std::cout << "test_result_success_and_failure passed!" << std::endl;
}

void test_echo_provider_and_agent() {
    EchoProvider echo("echo-test");
    Agent agent("Coder", "Implements features", echo.as_any());

    auto out = agent.run("Add unit tests");
    assert(out);
    assert(out.value().find("EchoProvider(echo-test)") != std::string::npos);
    assert(out.value().find("Add unit tests") != std::string::npos);
    assert(out.value().find("Coder") != std::string::npos);

    std::cout << "test_echo_provider_and_agent passed!" << std::endl;
}

void test_tool_registry() {
    Tool add(
        "add",
        "Add two numbers",
        [](const nlohmann::json& args) -> Result<nlohmann::json> {
            if (!args.contains("a") || !args.contains("b")) {
                return Error::invalid_argument("a and b required");
            }
            return nlohmann::json(args["a"].get<int>() + args["b"].get<int>());
        }
    );

    ToolRegistry registry;
    registry.add(std::move(add));

    ToolCall call;
    call.tool_name = "add";
    call.call_id = "c1";
    call.arguments = nlohmann::json{{"a", 7}, {"b", 8}};

    auto result = registry.execute(call);
    assert(result);
    assert(result.value().success);
    assert(result.value().result == 15);

    ToolCall missing;
    missing.tool_name = "nope";
    auto missing_result = registry.execute(missing);
    assert(!missing_result);
    assert(missing_result.error().code == ErrorCode::ToolNotFound);

    std::cout << "test_tool_registry passed!" << std::endl;
}

void test_protocol_modes() {
    TransferOptions base;
    base.task = "Ship C++ runtime";
    base.from_agent = "Architect";
    base.to_agent = "Coder";
    base.summary = "Design done";

    {
        HandoffProtocol protocol(ProtocolMode::HybridState);
        auto state = protocol.transfer(base);
        assert(state);
        assert(state.value().metadata.at("mode") == "hybrid_state");
        assert(!state.value().decisions.empty());
        assert(state.value().next_steps.size() >= 1);
    }
    {
        HandoffProtocol protocol(ProtocolMode::Natural);
        auto state = protocol.transfer(base);
        assert(state);
        assert(state.value().summary.find("handing off") != std::string::npos);
        assert(state.value().metadata.at("mode") == "natural");
    }
    {
        HandoffProtocol protocol(ProtocolMode::Compressed);
        TransferOptions long_opts = base;
        long_opts.summary = std::string(500, 'x');
        auto state = protocol.transfer(long_opts);
        assert(state);
        assert(state.value().summary.size() <= 360);
        assert(state.value().metadata.at("mode") == "compressed");
    }
    {
        HandoffProtocol protocol(ProtocolMode::HybridMin);
        auto state = protocol.transfer(base);
        assert(state);
        assert(state.value().metadata.at("mode") == "hybrid_min");
    }

    auto bad = parse_protocol_mode("nope");
    assert(!bad);

    std::cout << "test_protocol_modes passed!" << std::endl;
}

void test_team_sequential_handoff() {
    std::vector<Agent> agents;
    agents.emplace_back("Architect", "Designs systems", EchoProvider("echo").as_any());
    agents.emplace_back("Coder", "Writes code", EchoProvider("echo").as_any());
    agents.emplace_back("Reviewer", "Reviews code", EchoProvider("echo").as_any());

    Team team(std::move(agents), HandoffProtocol(ProtocolMode::HybridState));
    auto result = team.run("Implement handoff runtime");
    assert(result);
    assert(result.value().success);
    assert(result.value().agent_outputs.size() == 3);
    assert(result.value().handoffs.size() == 2);
    assert(result.value().handoffs[0].from_agent == "Architect");
    assert(result.value().handoffs[0].to_agent == "Coder");
    assert(result.value().handoffs[1].from_agent == "Coder");
    assert(result.value().handoffs[1].to_agent == "Reviewer");
    assert(!result.value().final_output.empty());

    auto wire = result.value().to_json();
    assert(wire.at("task") == "Implement handoff runtime");
    assert(wire.at("handoffs").is_array());
    assert(wire.at("handoffs").size() == 2);

    std::cout << "test_team_sequential_handoff passed!" << std::endl;
}

void test_any_provider_concurrent_usage_snapshot() {
    AnyProvider provider(
        "parallel-test",
        [](std::string_view prompt, const GenerateOptions&) -> Result<std::string> {
            std::this_thread::yield();
            return Result<std::string>::success(std::string(prompt));
        }
    );

    std::atomic<int> failures{0};
    std::vector<std::thread> workers;
    for (int worker = 0; worker < 8; ++worker) {
        workers.emplace_back([&, worker] {
            for (int call = 0; call < 100; ++call) {
                const std::string prompt = "worker-" + std::to_string(worker) + "-" + std::to_string(call);
                auto result = provider.generate(prompt);
                if (!result || result.value() != prompt) ++failures;
            }
        });
    }
    for (auto& worker : workers) worker.join();

    assert(failures.load() == 0);
    const auto usage = provider.last_usage();
    assert(usage.success);
    assert(usage.model == "parallel-test");
    assert(usage.selected_model == "parallel-test");
    assert(usage.prompt_chars > 0);
    assert(usage.completion_chars == usage.prompt_chars);
    std::cout << "test_any_provider_concurrent_usage_snapshot passed!" << std::endl;
}

void test_fallback_provider_concurrent_snapshots() {
    AnyProvider success(
        "success-model",
        [](std::string_view prompt, const GenerateOptions&) -> Result<std::string> {
            return Result<std::string>::success(std::string(prompt));
        }
    );
    FallbackProvider fallback(
        {FailingProvider("primary", "offline").as_any(), success},
        "resilient"
    );

    std::atomic<int> failures{0};
    std::vector<std::thread> workers;
    for (int i = 0; i < 12; ++i) {
        workers.emplace_back([&, i] {
            auto result = fallback.generate("task-" + std::to_string(i));
            if (!result) ++failures;
        });
    }
    for (auto& worker : workers) worker.join();

    const auto usage = fallback.last_usage();
    const auto errors = fallback.last_errors();
    assert(failures.load() == 0);
    assert(usage.success);
    assert(usage.model == "resilient");
    assert(usage.selected_model == "success-model");
    assert(errors.size() == 1);
    assert(errors.front().find("primary") != std::string::npos);
    std::cout << "test_fallback_provider_concurrent_snapshots passed!" << std::endl;
}

void test_agent_requires_provider() {
    Agent bare("X", "role");
    auto out = bare.run("task");
    assert(!out);
    assert(out.error().code == ErrorCode::ProviderFailed);
    std::cout << "test_agent_requires_provider passed!" << std::endl;
}

}  // namespace

int main() {
    test_version_string();
    test_result_success_and_failure();
    test_echo_provider_and_agent();
    test_tool_registry();
    test_protocol_modes();
    test_team_sequential_handoff();
    test_any_provider_concurrent_usage_snapshot();
    test_fallback_provider_concurrent_snapshots();
    test_agent_requires_provider();
    std::cout << "All C++ runtime tests passed successfully!" << std::endl;
    return 0;
}
