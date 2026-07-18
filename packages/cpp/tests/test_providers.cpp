#include <handoffkit/runtime/providers.hpp>
#include <handoffkit/runtime/http_provider.hpp>
#include <handoffkit/cli/cli_app.hpp>

#include <cassert>
#include <iostream>
#include <set>
#include <string>

using namespace handoffkit;

namespace {

void test_catalog_contains_python_natives() {
    auto names = list_provider_names();
    assert(names.size() >= 15);
    std::set<std::string> set(names.begin(), names.end());
    for (const char* required : {
             "echo", "openai", "nvidia", "openrouter", "groq", "grok", "together",
             "fireworks", "deepinfra", "perplexity", "mistral", "cerebras",
             "sambanova", "zai", "ollama", "opencode-go", "opencode-zen",
         }) {
        assert(set.count(required) == 1);
    }
    auto nvidia = get_provider_config("nvidia");
    assert(nvidia);
    assert(nvidia.value().api_key_env == "NVIDIA_API_KEY");
    assert(nvidia.value().default_base_url.find("nvidia.com") != std::string::npos);
    std::cout << "test_catalog_contains_python_natives passed count=" << names.size() << "\n";
}

void test_echo_make_provider() {
    auto p = make_provider("echo");
    assert(p);
    auto out = p.value().generate("hello world");
    assert(out);
    assert(out.value().find("hello world") != std::string::npos);
    std::cout << "test_echo_make_provider passed\n";
}

void test_resolve_without_key_when_allowed() {
    ProviderResolveOptions opt;
    opt.allow_missing_key = true;
    opt.model = "custom-model";
    auto r = resolve_provider_settings("groq", opt);
    assert(r);
    assert(r.value().model == "custom-model");
    assert(r.value().base_url.find("groq.com") != std::string::npos);
    assert(r.value().to_json().contains("api_key_set"));
    std::cout << "test_resolve_without_key_when_allowed passed\n";
}

void test_resolve_requires_key_by_default() {
    // Use a provider that requires key; without env should fail unless allow_missing_key.
    ProviderResolveOptions opt;
    opt.allow_missing_key = false;
    // If user machine has GROQ_API_KEY set, skip strict assert
    if (env_or_empty("GROQ_API_KEY").empty()) {
        auto r = resolve_provider_settings("groq", opt);
        assert(!r);
        assert(r.error().message.find("GROQ_API_KEY") != std::string::npos);
    }
    std::cout << "test_resolve_requires_key_by_default passed\n";
}

void test_unknown_provider() {
    auto r = get_provider_config("not-a-real-provider");
    assert(!r);
    auto m = make_provider("not-a-real-provider");
    assert(!m);
    std::cout << "test_unknown_provider passed\n";
}

void test_parse_models_list() {
    nlohmann::json payload = {
        {"data", nlohmann::json::array({
            nlohmann::json{{"id", "model-a"}},
            nlohmann::json{{"id", "model-b"}},
        })},
    };
    auto ids = parse_openai_models_list(payload);
    assert(ids);
    assert(ids.value().size() == 2);
    assert(ids.value()[0] == "model-a");
    std::cout << "test_parse_models_list passed\n";
}

void test_cli_providers() {
    auto list = cli::run_cli({"providers", "list"});
    assert(list.exit_code == 0);
    assert(list.stdout_text.find("nvidia") != std::string::npos);
    assert(list.stdout_text.find("groq") != std::string::npos);
    assert(list.stdout_text.find("echo") != std::string::npos);

    auto show = cli::run_cli({"providers", "show", "nvidia"});
    assert(show.exit_code == 0);
    assert(show.stdout_text.find("NVIDIA_API_KEY") != std::string::npos);

    auto resolve = cli::run_cli({"providers", "resolve", "ollama", "--allow-missing-key"});
    assert(resolve.exit_code == 0);
    assert(resolve.stdout_text.find("11434") != std::string::npos ||
           resolve.stdout_text.find("base_url") != std::string::npos);

    auto doctor = cli::run_cli({"doctor"});
    assert(doctor.exit_code == 0);
    assert(doctor.stdout_text.find("providers=") != std::string::npos);
    std::cout << "test_cli_providers passed\n";
}

void test_openrouter_headers_defaults() {
    ProviderResolveOptions opt;
    opt.allow_missing_key = true;
    auto r = resolve_provider_settings("openrouter", opt);
    assert(r);
    assert(r.value().headers.count("HTTP-Referer") == 1);
    assert(r.value().headers.count("X-Title") == 1);
    std::cout << "test_openrouter_headers_defaults passed\n";
}

}  // namespace

int main() {
    test_catalog_contains_python_natives();
    test_echo_make_provider();
    test_resolve_without_key_when_allowed();
    test_resolve_requires_key_by_default();
    test_unknown_provider();
    test_parse_models_list();
    test_cli_providers();
    test_openrouter_headers_defaults();
    std::cout << "All provider tests passed\n";
    return 0;
}
