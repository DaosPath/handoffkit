#include <handoffkit/demos/fusion/engine.hpp>
#include <handoffkit/demos/fusion/web_research.hpp>
#include <handoffkit/browser/kit.hpp>
#include <handoffkit/explore/transport.hpp>

#include <cassert>
#include <iostream>
#include <string>

using namespace handoffkit::demos::fusion;
using namespace handoffkit::explore;

void test_extract_urls() {
    auto u = handoffkit::demos::fusion::extract_urls_from_text(
        "See https://example.com/a and also http://foo.org/x). End."
    );
    assert(u.size() >= 2);
    assert(u[0].find("example.com") != std::string::npos);
    std::cout << "test_extract_urls ok\n";
}

void test_search_query_from_draco_wrapper() {
    const std::string wrapped =
        "Deep research style answer (research only). Be concrete, structured, and cite "
        "verifiable claims where possible.\n\n"
        "TASK:\nWhat was the name of the 5K race hosted at the old Great America theme park "
        "in California that had \"bubble gum\" in its title?";
    auto q = handoffkit::demos::fusion::make_search_query_from_task(wrapped);
    assert(q.find("Great America") != std::string::npos);
    assert(q.find("bubble") != std::string::npos);
    assert(q.find("Deep research") == std::string::npos);
    std::cout << "test_search_query_from_draco_wrapper ok q=" << q.substr(0, 80) << "\n";
}

void test_gather_seed_fixture() {
    FusionConfig cfg;
    cfg.task = "Summarize the fixture home page.";
    cfg.enable_web_tools = true;
    cfg.web_transport = "map";
    cfg.web_auto_search = false;
    cfg.seed_urls = {"https://fixture.local/"};
    cfg.web_max_pages = 2;
    cfg.web_max_depth = 1;
    cfg.web_prefer_explore = true;
    cfg.web_context_max_chars = 8000;

    auto map = make_fixture_map_transport();
    auto wr = gather_web_research(cfg, map);
    assert(wr.enabled);
    assert(wr.used);
    assert(wr.pages_ok >= 1);
    assert(wr.tool_calls >= 1);
    assert(wr.markdown_context.find("Fixture") != std::string::npos ||
           wr.markdown_context.find("fixture") != std::string::npos ||
           wr.markdown_context.find("Welcome") != std::string::npos);
    auto section = wr.prompt_section();
    assert(section.find("web research") != std::string::npos ||
           section.find("Markdown") != std::string::npos);
    std::cout << "test_gather_seed_fixture ok pages=" << wr.pages_ok
              << " md_chars=" << wr.markdown_context.size() << "\n";
}

void test_fusion_deep_uses_browser_lite_route() {
    FusionConfig cfg;
    cfg.task = "Deeply summarize the fixture site.";
    cfg.enable_web_tools = true;
    cfg.web_transport = "map";
    cfg.web_auto_search = false;
    cfg.seed_urls = {"https://fixture.local/"};
    cfg.web_max_pages = 6;
    cfg.web_max_depth = 2;
    cfg.web_context_max_chars = 12000;

    auto wr = gather_web_research(cfg, make_fixture_map_transport());
    assert(wr.enabled);
    assert(wr.used);
    assert(wr.pages_ok >= 1);
    assert(wr.markdown_context.find("Fixture") != std::string::npos);
    bool saw_done = false;
    for (const auto& step : wr.steps) {
        if (step.value("tool", "") == "deep_research_done") saw_done = true;
    }
    assert(saw_done);
    std::cout << "test_fusion_deep_uses_browser_lite_route ok pages=" << wr.pages_ok << "\n";
}

void test_fusion_echo_with_web_md() {
    FusionConfig cfg;
    cfg.task = "Using only the provided web research, name the fixture site title.";
    cfg.mode = FusionMode::Lean;
    cfg.profile = FusionProfileId::Research;
    cfg.provider = "echo";
    cfg.write_files = false;
    cfg.cache.enabled = false;
    cfg.enable_web_tools = true;
    cfg.web_transport = "map";
    cfg.web_auto_search = false;
    cfg.seed_urls = {"https://fixture.local/"};
    cfg.web_max_pages = 2;
    cfg.web_prefer_explore = true;

    auto run = run_fusion(cfg);
    assert(run);
    assert(run.value().success);
    assert(run.value().report.contains("web_research"));
    const auto& wr = run.value().report["web_research"];
    assert(wr.value("enabled", false));
    assert(wr.value("used", false));
    assert(wr.value("pages_ok", 0) >= 1);
    assert(run.value().report.value("web_tools_live", false));
    // Echo provider reflects prompt; research section should influence branch chars.
    assert(run.value().metrics.llm_calls == 3);
    std::cout << "test_fusion_echo_with_web_md ok tool_calls="
              << wr.value("tool_calls", 0) << "\n";
}

void test_registry_has_web_search() {
    auto map = make_fixture_map_transport();
    auto reg = make_fusion_web_tool_registry(map);
    assert(reg.contains("web_fetch"));
    assert(reg.contains("web_fetch_markdown"));
    assert(reg.contains("web_explore"));
    assert(reg.contains("html_to_markdown"));
    assert(reg.contains("web_search"));
    assert(reg.contains("web_deep_research"));
    handoffkit::ToolCall deep;
    deep.tool_name = "web_deep_research";
    deep.arguments = {
        {"query", "fixture"},
        {"auto_search", false},
        {"seed_urls", nlohmann::json::array({"https://fixture.local/"})},
        {"max_pages", 2},
        {"max_depth", 1},
        {"transport", "map"},
    };
    auto dr = reg.execute(deep);
    assert(dr && dr.value().success);
    assert(dr.value().result.value("success", false));
    assert(dr.value().result.value("mode", "") == "deep_search_then_explore");
    assert(dr.value().result.value("metadata", nlohmann::json::object()).value("user_browser_required", true) == false);

    auto search_map = make_fixture_map_transport();
    search_map->set_page(
        "https://html.duckduckgo.com/html/?q=OpenAI+product+docs",
        R"(<a class="result__a" href="https://fixture.local/">Fixture</a>)");
    search_map->set_page(
        "https://html.duckduckgo.com/html/?q=OpenAI+security",
        R"(<a class="result__a" href="https://fixture.local/about.html">About</a>)");
    auto search_reg = make_fusion_web_tool_registry(search_map);
    handoffkit::ToolCall expanded;
    expanded.tool_name = "web_deep_research";
    expanded.arguments = {
        {"query", "OpenAI product docs"},
        {"task", "OpenAI security."},
        {"max_pages", 3},
        {"max_depth", 1},
        {"max_sub_queries", 2},
        {"max_results_per_query", 2},
        {"transport", "map"},
    };
    auto expanded_result = search_reg.execute(expanded);
    assert(expanded_result && expanded_result.value().success);
    assert(expanded_result.value().result.value("success", false));
    assert(expanded_result.value().result.value("queries", nlohmann::json::array()).size() == 2);
    assert(expanded_result.value().result.value("pages_ok", 0) >= 2);

    auto wiki_map = make_fixture_map_transport();
    wiki_map->set_page(
        "https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=6&search=OpenAI",
        R"(["OpenAI",["OpenAI"],[""],["https://en.wikipedia.org/wiki/OpenAI"]])");
    auto wiki_reg = make_fusion_web_tool_registry(wiki_map);
    handoffkit::ToolCall wiki_call;
    wiki_call.tool_name = "web_search";
    wiki_call.arguments = {
        {"query", "OpenAI"},
        {"providers", nlohmann::json::array({"wiki"})},
        {"transport", "map"},
    };
    auto wiki_result = wiki_reg.execute(wiki_call);
    assert(wiki_result && wiki_result.value().success);
    assert(wiki_result.value().result.value("providers_requested", nlohmann::json::array()).size() == 1);
    assert(wiki_result.value().result.value("providers_used", nlohmann::json::array()).at(0) == "wikipedia");

    handoffkit::ToolCall unavailable_call;
    unavailable_call.tool_name = "web_search";
    unavailable_call.arguments = {
        {"query", "OpenAI"},
        {"providers", nlohmann::json::array({"bing"})},
        {"transport", "map"},
    };
    auto unavailable_result = wiki_reg.execute(unavailable_call);
    assert(unavailable_result && unavailable_result.value().success);
    assert(unavailable_result.value().result.value("success", true) == false);
    assert(unavailable_result.value().result.value("error_code", "") == "provider_unavailable");
    std::cout << "test_registry_has_web_search ok\n";
}

void test_browser_kit_provider_defaults() {
    handoffkit::browser::BrowserAgentKitOptions options;
    auto map = handoffkit::browser::make_fixture_map_transport();
    options.transport = map;
    options.providers = {"wiki"};
    auto kit = handoffkit::browser::create_browser_agent_kit(options);
    map->set_page(
        "https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=6&search=OpenAI",
        R"(["OpenAI",["OpenAI"],[""],["https://en.wikipedia.org/wiki/OpenAI"]])");

    const auto direct = kit.search("OpenAI");
    assert(direct.value("providers_requested", nlohmann::json::array()).at(0) == "wiki");
    assert(direct.value("providers_used", nlohmann::json::array()).at(0) == "wikipedia");

    handoffkit::ToolCall call;
    call.tool_name = "web_search";
    call.arguments = {{"query", "OpenAI"}};
    const auto tool = kit.registry.execute(call);
    assert(tool && tool.value().success);
    assert(tool.value().result.value("providers_requested", nlohmann::json::array()).at(0) == "wiki");
    std::cout << "test_browser_kit_provider_defaults ok\n";
}

int main() {
    test_extract_urls();
    test_search_query_from_draco_wrapper();
    test_gather_seed_fixture();
    test_fusion_deep_uses_browser_lite_route();
    test_fusion_echo_with_web_md();
    test_registry_has_web_search();
    test_browser_kit_provider_defaults();
    std::cout << "ALL test_fusion_web_research PASSED\n";
    return 0;
}
