#include <handoffkit/explore/explorer.hpp>
#include <handoffkit/explore/html_extract.hpp>
#include <handoffkit/explore/tools.hpp>
#include <handoffkit/explore/transport.hpp>
#include <handoffkit/explore/web_types.hpp>
#include <handoffkit/runtime/tool.hpp>

#include <cassert>
#include <iostream>
#include <string>

using namespace handoffkit;
using namespace handoffkit::explore;

void test_html_extract() {
    const std::string html = R"(
<html><head><title>Hello &amp; World</title>
<style>.x{color:red}</style>
<script>var x=1;</script>
</head>
<body>
<p>First paragraph with <b>bold</b> text.</p>
<a href="/next">Next Page</a>
<a href="https://other.example/out">Out</a>
</body></html>
)";
    assert(extract_title(html) == "Hello & World");
    auto text = extract_text(html, true, 5000);
    assert(text.find("First paragraph") != std::string::npos);
    assert(text.find("var x") == std::string::npos);  // script stripped
    auto links = extract_links(html, "https://fixture.local/", 10);
    assert(links.size() >= 2);
    bool found_next = false;
    for (const auto& l : links) {
        if (l.absolute == "https://fixture.local/next") found_next = true;
    }
    assert(found_next);
    ExplorePolicy pol;
    auto page = extract_page("https://fixture.local/", html, pol);
    assert(page.title == "Hello & World");
    assert(!page.text.empty());
    assert(!page.links.empty());
    assert(!page.markdown.empty());
    assert(page.markdown.find("# Hello & World") != std::string::npos);
    assert(page.markdown.find("Source:") != std::string::npos);
    assert(page.markdown.find("[Next Page](https://fixture.local/next)") != std::string::npos);
    assert(page.markdown.find("var x") == std::string::npos);
    std::cout << "test_html_extract ok\n";
}

void test_html_to_markdown_tool() {
    const std::string html = R"(
<html><head><title>MD Tool</title></head>
<body>
<h1>Section One</h1>
<p>Hello <strong>world</strong> and <em>friends</em>.</p>
<ul><li>Item A</li><li>Item B</li></ul>
<a href="/docs">Docs</a>
</body></html>
)";
    HtmlToMarkdownOptions opts;
    opts.base_url = "https://example.test/";
    auto md = html_to_markdown(html, opts);
    assert(md.find("# MD Tool") != std::string::npos || md.find("# Section One") != std::string::npos);
    assert(md.find("**world**") != std::string::npos || md.find("world") != std::string::npos);
    assert(md.find("- Item A") != std::string::npos);
    assert(md.find("## Links") != std::string::npos);
    assert(md.find("https://example.test/docs") != std::string::npos);

    auto map = make_fixture_map_transport();
    ToolRegistry reg;
    register_web_explorer_tools(reg, map);
    assert(reg.contains("html_to_markdown"));
    assert(reg.contains("web_fetch_markdown"));

    ToolCall pure;
    pure.tool_name = "html_to_markdown";
    pure.arguments = {{"html", html}, {"url", "https://example.test/"}};
    auto pr = reg.execute(pure);
    assert(pr && pr.value().success);
    assert(pr.value().result["success"] == true);
    assert(pr.value().result["format"] == "markdown");
    assert(pr.value().result["markdown"].get<std::string>().find("Item A") != std::string::npos);

    ToolCall fetch_md;
    fetch_md.tool_name = "web_fetch_markdown";
    fetch_md.arguments = {
        {"url", "https://fixture.local/"},
        {"allow_hosts", nlohmann::json::array({"fixture.local"})},
    };
    auto fr = reg.execute(fetch_md);
    assert(fr && fr.value().success);
    assert(fr.value().result["success"] == true);
    assert(fr.value().result["format"] == "markdown");
    auto fmd = fr.value().result["markdown"].get<std::string>();
    assert(fmd.find("Fixture") != std::string::npos);
    assert(fmd.find("Source:") != std::string::npos || fmd.find("#") != std::string::npos);

    // web_fetch also exposes markdown field
    ToolCall wf;
    wf.tool_name = "web_fetch";
    wf.arguments = {{"url", "https://fixture.local/"}, {"allow_hosts", nlohmann::json::array({"fixture.local"})}};
    auto wr = reg.execute(wf);
    assert(wr && wr.value().success);
    assert(wr.value().result.contains("markdown"));
    assert(!wr.value().result["markdown"].get<std::string>().empty());
    std::cout << "test_html_to_markdown_tool ok\n";
}

void test_url_and_host_policy() {
    ExplorePolicy p;
    p.deny_hosts = {"evil.example"};
    p.allow_hosts = {"fixture.local"};
    assert(host_allowed("fixture.local", p));
    assert(host_allowed("www.fixture.local", p));
    assert(!host_allowed("evil.example", p));
    assert(!host_allowed("other.com", p));  // not in allowlist

    ExplorePolicy open;
    open.deny_hosts = {"blocked.test"};
    assert(host_allowed("anything.com", open));
    assert(!host_allowed("blocked.test", open));

    auto abs = resolve_url("https://fixture.local/docs/", "guide.html");
    assert(abs == "https://fixture.local/docs/guide.html");
    auto root = resolve_url("https://fixture.local/docs/x", "/about.html");
    assert(root == "https://fixture.local/about.html");

    assert(url_allowed("https://fixture.local/a", p, "fixture.local"));
    assert(!url_allowed("https://evil.example/a", p, "fixture.local"));
    std::cout << "test_url_and_host_policy ok\n";
}

void test_fetch_and_explore_fixture() {
    auto map = make_fixture_map_transport();
    WebExplorer ex(map);
    ExplorePolicy pol;
    pol.max_depth = 0;
    pol.max_pages = 1;
    pol.same_host_only = true;
    pol.allow_hosts = {"fixture.local"};

    auto one = ex.fetch("https://fixture.local/", pol);
    assert(one);
    assert(one.value().success);
    assert(one.value().title == "Fixture Home");
    assert(one.value().text.find("Welcome to Fixture") != std::string::npos);
    assert(!one.value().markdown.empty());
    assert(one.value().markdown.find("Fixture Home") != std::string::npos);
    assert(one.value().pages_fetched == 1);
    auto j = one.value().to_json();
    assert(j["success"] == true);
    assert(j.contains("final_url"));
    assert(j.contains("title"));
    assert(j.contains("text"));
    assert(j.contains("markdown"));
    assert(j.contains("links"));
    assert(j.contains("steps"));
    assert(j["steps"].is_array() && !j["steps"].empty());
    assert(j["steps"][0].contains("markdown"));
    assert(j["title"].get<std::string>().find("Fixture") != std::string::npos);

    // multi-step
    pol.max_depth = 2;
    pol.max_pages = 5;
    auto multi = ex.explore("https://fixture.local/", pol);
    assert(multi);
    assert(multi.value().success);
    assert(multi.value().pages_fetched >= 2);
    assert(multi.value().steps.size() >= 2);
    // ordered step_index
    for (std::size_t i = 0; i < multi.value().steps.size(); ++i) {
        assert(multi.value().steps[i].step_index == static_cast<int>(i));
    }
    // external evil should be blocked when same_host_only
    bool saw_blocked_evil = false;
    for (const auto& st : multi.value().steps) {
        for (const auto& b : st.blocked_links) {
            if (b.find("evil.example") != std::string::npos) saw_blocked_evil = true;
        }
    }
    assert(saw_blocked_evil);

    // max_pages stops expansion
    ExplorePolicy tiny;
    tiny.max_depth = 5;
    tiny.max_pages = 1;
    tiny.allow_hosts = {"fixture.local"};
    auto limited = ex.explore("https://fixture.local/", tiny);
    assert(limited && limited.value().pages_fetched == 1);

    // deny start host
    ExplorePolicy deny;
    deny.deny_hosts = {"fixture.local"};
    auto denied = ex.explore("https://fixture.local/", deny);
    assert(denied);
    assert(!denied.value().success);
    assert(denied.value().error.find("denied") != std::string::npos);

    // transport error surfaces
    auto boom = ex.fetch("https://fixture.local/boom", pol);
    assert(boom);
    assert(!boom.value().success);
    assert(boom.value().error.find("simulated") != std::string::npos);

    // 404 surfaces as failed step
    auto miss = ex.fetch("https://fixture.local/missing.html", pol);
    assert(miss);
    assert(!miss.value().success);
    assert(miss.value().steps[0].status == 404);

    std::cout << "test_fetch_and_explore_fixture ok pages="
              << multi.value().pages_fetched << "\n";
}

void test_depth_zero_vs_depth_one() {
    auto map = make_fixture_map_transport();
    WebExplorer ex(map);
    ExplorePolicy d0;
    d0.max_depth = 0;
    d0.max_pages = 10;
    d0.allow_hosts = {"fixture.local"};
    auto r0 = ex.explore("https://fixture.local/", d0);
    assert(r0 && r0.value().pages_fetched == 1);

    ExplorePolicy d1 = d0;
    d1.max_depth = 1;
    auto r1 = ex.explore("https://fixture.local/", d1);
    assert(r1 && r1.value().pages_fetched >= 2);
    assert(r1.value().pages_fetched > r0.value().pages_fetched);
    std::cout << "test_depth_zero_vs_depth_one ok\n";
}

void test_tools_registry() {
    auto map = make_fixture_map_transport();
    ToolRegistry reg;
    register_web_explorer_tools(reg, map);
    assert(reg.contains("web_fetch"));
    assert(reg.contains("web_explore"));

    ToolCall call;
    call.tool_name = "web_fetch";
    call.arguments = {
        {"url", "https://fixture.local/"},
        {"transport", "map"},
        {"policy", {{"max_depth", 0}, {"max_pages", 1}, {"allow_hosts", nlohmann::json::array({"fixture.local"})}}},
    };
    auto tr = reg.execute(call);
    assert(tr);
    assert(tr.value().success);
    assert(tr.value().result["success"] == true);
    assert(tr.value().result["title"].get<std::string>().find("Fixture") != std::string::npos);
    assert(tr.value().result.contains("final_url"));
    assert(tr.value().result.contains("steps"));

    ToolCall explore_call;
    explore_call.tool_name = "web_explore";
    explore_call.arguments = {
        {"url", "https://fixture.local/"},
        {"max_depth", 1},
        {"max_pages", 4},
        {"allow_hosts", nlohmann::json::array({"fixture.local"})},
    };
    auto er = reg.execute(explore_call);
    assert(er);
    assert(er.value().success);
    assert(er.value().result["success"] == true);
    assert(er.value().result["pages_fetched"].get<int>() >= 2);

    // denylist / blocked host -> controlled failure
    ToolCall bad;
    bad.tool_name = "web_fetch";
    bad.arguments = {
        {"url", "https://fixture.local/"},
        {"deny_hosts", nlohmann::json::array({"fixture.local"})},
    };
    auto br = reg.execute(bad);
    assert(br);
    // tool execute succeeds as ToolResult; payload success=false
    assert(br.value().success);  // handler returned JSON
    assert(br.value().result["success"] == false);
    assert(br.value().result["error"].get<std::string>().find("denied") != std::string::npos);

    // missing url
    ToolCall miss;
    miss.tool_name = "web_fetch";
    miss.arguments = nlohmann::json::object();
    auto mr = reg.execute(miss);
    assert(mr);
    assert(!mr.value().success);
    assert(!mr.value().error.empty());

    std::cout << "test_tools_registry ok\n";
}

void test_policy_json_roundtrip() {
    ExplorePolicy p;
    p.max_depth = 3;
    p.max_pages = 9;
    p.user_agent = "ForkBot/1.0";
    p.allow_hosts = {"a.com"};
    p.deny_hosts = {"b.com"};
    p.extra_headers["X-Custom"] = "yes";
    auto j = p.to_json();
    assert(j["max_depth"] == 3);
    assert(j["user_agent"] == "ForkBot/1.0");
    auto back = ExplorePolicy::from_json(j);
    assert(back);
    assert(back.value().max_depth == 3);
    assert(back.value().extra_headers.at("X-Custom") == "yes");
    std::cout << "test_policy_json_roundtrip ok\n";
}

int main() {
    test_html_extract();
    test_html_to_markdown_tool();
    test_url_and_host_policy();
    test_policy_json_roundtrip();
    test_fetch_and_explore_fixture();
    test_depth_zero_vs_depth_one();
    test_tools_registry();
    std::cout << "All web explorer tests passed\n";
    return 0;
}
