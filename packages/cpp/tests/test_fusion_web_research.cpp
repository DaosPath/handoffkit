#include <handoffkit/demos/fusion/engine.hpp>
#include <handoffkit/demos/fusion/web_research.hpp>
#include <handoffkit/explore/transport.hpp>

#include <cassert>
#include <iostream>
#include <string>

using namespace handoffkit::demos::fusion;
using namespace handoffkit::explore;

void test_extract_urls() {
    auto u = extract_urls_from_text(
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
    auto q = make_search_query_from_task(wrapped);
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
    std::cout << "test_registry_has_web_search ok\n";
}

int main() {
    test_extract_urls();
    test_search_query_from_draco_wrapper();
    test_gather_seed_fixture();
    test_fusion_echo_with_web_md();
    test_registry_has_web_search();
    std::cout << "ALL test_fusion_web_research PASSED\n";
    return 0;
}
