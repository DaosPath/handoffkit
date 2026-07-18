// Core-only tests: link handoffkit_core (no demos/fusion).
// Covers fallback provider, usage metrics, and default safe tool registry.

#include <handoffkit/handoffkit_core.hpp>

#include <cassert>
#include <iostream>
#include <string>
#include <vector>

using namespace handoffkit;

void test_usage_on_echo_generate() {
    auto p = EchoProvider("echo-usage").as_any();
    auto out = p.generate("measure me please");
    assert(out);
    assert(out.value().find("measure me please") != std::string::npos);

    const auto u = p.last_usage();
    assert(u.success);
    assert(u.prompt_chars == std::string("measure me please").size());
    assert(u.completion_chars == out.value().size());
    assert(u.completion_chars > 0);
    assert(u.prompt_tokens_est > 0);
    assert(u.completion_tokens_est > 0);
    assert(u.model == "echo-usage" || u.selected_model == "echo-usage");

    const auto j = u.to_json();
    assert(j.contains("prompt_chars"));
    assert(j.contains("completion_chars"));
    assert(j.contains("prompt_tokens_est"));
    assert(j.contains("completion_tokens_est"));
    assert(j.contains("success"));
    assert(j.value("success", false));
    assert(j["prompt_chars"].get<std::size_t>() == u.prompt_chars);
    std::cout << "test_usage_on_echo_generate ok " << j.dump() << "\n";
}

void test_fallback_to_secondary() {
    FailingProvider primary("primary-fail", "primary down");
    EchoProvider secondary("secondary-echo");

    std::vector<AnyProvider> chain;
    chain.push_back(primary.as_any());
    chain.push_back(secondary.as_any());

    FallbackProvider fb(std::move(chain), "fallback-chain");
    auto out = fb.generate("hello from fallback");
    assert(out);
    assert(out.value().find("hello from fallback") != std::string::npos);
    assert(out.value().find("secondary-echo") != std::string::npos ||
           out.value().find("EchoProvider") != std::string::npos);

    const auto u = fb.last_usage();
    assert(u.success);
    assert(u.selected_model == "secondary-echo");
    assert(u.completion_chars > 0);
    assert(fb.last_errors().size() >= 1);
    assert(fb.last_errors()[0].find("primary") != std::string::npos ||
           fb.last_errors()[0].find("forced") != std::string::npos ||
           fb.last_errors()[0].find("down") != std::string::npos);

    // All fail
    FallbackProvider all_fail(
        {FailingProvider("a").as_any(), FailingProvider("b", "b-fail").as_any()},
        "all-fail"
    );
    auto bad = all_fail.generate("x");
    assert(!bad);
    assert(!all_fail.last_usage().success);
    std::cout << "test_fallback_to_secondary ok selected=" << u.selected_model << "\n";
}

void test_default_safe_registry_no_shell() {
    ToolRegistry reg;
    register_default_safe_tools(reg);
    const auto names = reg.names();
    assert(!names.empty());
    for (const auto& n : names) {
        assert(n != "shell");
        assert(n.find("shell") == std::string::npos);
    }
    assert(!reg.contains("shell"));

    const auto safe = default_safe_tool_names();
    for (const auto& n : safe) {
        assert(n != "shell");
        assert(reg.contains(n));
    }

    // Opt-in shell slot exists but is denied
    register_shell_tool(reg);
    assert(reg.contains("shell"));
    ToolCall call;
    call.tool_name = "shell";
    call.arguments = {{"command", "echo should-not-run"}};
    auto exec = reg.execute(call);
    assert(exec);
    assert(!exec.value().success);
    assert(exec.value().error.find("denied") != std::string::npos ||
           exec.value().error.find("not enabled") != std::string::npos);

    // Fresh default still has no shell
    ToolRegistry reg2;
    register_demo_toolbox(reg2);
    assert(!reg2.contains("shell"));
    std::cout << "test_default_safe_registry_no_shell ok tools=" << names.size() << "\n";
}

void test_core_umbrella_links() {
    // Structural: core umbrella + version present; no fusion symbols required.
    assert(std::string(version()).find("1.") == 0);
    Team team(
        {Agent("A", "role", EchoProvider().as_any()),
         Agent("B", "role", EchoProvider().as_any())},
        HandoffProtocol(ProtocolMode::HybridState)
    );
    auto r = team.run("core path");
    assert(r);
    std::cout << "test_core_umbrella_links ok version=" << version() << "\n";
}

int main() {
    test_usage_on_echo_generate();
    test_fallback_to_secondary();
    test_default_safe_registry_no_shell();
    test_core_umbrella_links();
    std::cout << "ALL test_core_runtime PASSED\n";
    return 0;
}
