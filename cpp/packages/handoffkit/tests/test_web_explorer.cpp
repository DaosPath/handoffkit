#include <handoffkit/explore/explorer.hpp>
#include <handoffkit/explore/html_extract.hpp>
#include <handoffkit/explore/tools.hpp>
#include <handoffkit/explore/transport.hpp>
#include <handoffkit/explore/web_types.hpp>
#include <handoffkit/runtime/tool.hpp>
#include <handoffkit/browser/page.hpp>

#include <cassert>
#include <chrono>
#include <iostream>
#include <string>
#include <string_view>

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
    const std::string table_html = R"(
<html><head><title>Table</title>
<script type="application/ld+json">{"@type":"Article","name":"Demo"}</script>
</head><body>
<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
</body></html>
)";
    auto table_md = html_table_to_markdown(table_html);
    assert(table_md.find("| A | B |") != std::string::npos);
    auto json_ld = extract_json_ld(table_html);
    assert(!json_ld.empty());
    assert(json_ld[0].contains("@type"));
    assert(json_ld[0]["@type"] == "Article");
    auto page_md = html_to_markdown(table_html, HtmlToMarkdownOptions{});
    assert(page_md.find("| A | B |") != std::string::npos);
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

void test_noise_strip_pathological_nesting() {
    // Regression: the old container regex blew libstdc++'s recursive matcher
    // (86k stack frames, SIGSEGV) on deeply nested real-world pages.
    std::string html = "<html><body><div class=\"content\">Real text here.";
    for (int i = 0; i < 3000; ++i) html += "<div><span>noise</span>";
    for (int i = 0; i < 3000; ++i) html += "</div>";
    html += "</div><div class=\"ad-banner\">Buy now</div><p>5 &lt; 6 tail</p></body></html>";
    const auto text = extract_text(html, true, 500000);
    assert(text.find("Real text here") != std::string::npos);
    assert(text.find("Buy now") == std::string::npos);
    assert(text.find("5 < 6") != std::string::npos);
    std::cout << "test_noise_strip_pathological_nesting ok chars=" << text.size() << "\n";
}

// --- CodeQL parity (JS 15ad204): linear HTML scanning, scheme guard ---------

constexpr int kRedosRepeat = 50000;
// Single-character runs need longer input to expose quadratic/recursive paths.
constexpr int kRunRepeat = 200000;

std::string repeat(std::string_view s, int n) {
    std::string out;
    out.reserve(s.size() * static_cast<std::size_t>(n));
    for (int i = 0; i < n; ++i) out.append(s);
    return out;
}

template <class F>
auto assert_fast(const char* label, F&& fn, long long budget_ms = 1500) {
    const auto started = std::chrono::steady_clock::now();
    auto value = fn();
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - started).count();
    if (ms >= budget_ms) {
        std::cerr << label << " took " << ms << "ms\n";
        assert(false && "pathological input exceeded time budget");
    }
    return value;
}

void test_html_extraction_linear_on_pathological_attributes() {
    const std::string fallback = "https://fallback.test/";
    assert(assert_fast("json-ld", [&] {
        return extract_json_ld("<script " + repeat(R"(type="application/ld+json")", kRedosRepeat));
    }).empty());
    assert(assert_fast("canonical", [&] {
        return extract_page_metadata("<link " + repeat(R"(rel="canonical")", kRedosRepeat), fallback);
    })["canonical"] == fallback);
    assert(assert_fast("canonical href", [&] {
        return extract_page_metadata("<link " + repeat(R"(href="")", kRedosRepeat), fallback);
    })["canonical"] == fallback);
    assert(assert_fast("links", [&] {
        return extract_links("<a " + repeat(R"(href="")", kRedosRepeat), "", 100);
    }).empty());
    assert(assert_fast("anchors", [&] {
        return scan_href_anchors("<a " + repeat("<a ", kRedosRepeat));
    }).empty());
    assert(assert_fast("meta unclosed", [&] {
        return extract_page_metadata("<meta " + repeat(R"(name="description")", kRedosRepeat), fallback);
    })["description"] == "");
    assert(assert_fast("meta closed", [&] {
        return extract_page_metadata(
            "<meta " + repeat(R"(name="description" )", kRedosRepeat) + R"(content="Ada">)", fallback);
    })["description"] == "Ada");
    assert(assert_fast("charset run", [&] {
        return extract_page_metadata("charset" + repeat(" ", kRunRepeat) + "x", fallback);
    })["charset"] == "");
    assert(assert_fast("unclosed scripts", [&] {
        return extract_text("<body><p>keep</p>" + repeat("<script>", kRedosRepeat) + "</body>");
    }) == "keep");
    assert(assert_fast("many closed scripts", [&] {
        return extract_text("<body><p>keep</p>" + repeat("<script>x</script >", kRedosRepeat) + "</body>");
    }) == "keep");
    std::cout << "test_html_extraction_linear_on_pathological_attributes ok\n";
}

void test_html_metadata_order_and_case_variants() {
    const std::string html = R"(<html><head><title>T</title>
<META CONTENT="Desc &amp; more" NAME="Description">
<meta property="og:description" content="OG">
<meta charset=UTF-8>
<link href="https://example.org/canon" rel="canonical">
<script type="application/ld+json">{"@type":"Article","name":"x"}</script >
<script type='Application/LD+JSON'>{"@type":"NewsArticle"}</script
>
<script>var x = "</scriptx>";</script>
</head><body><p>Body text</p></body></html>)";
    const auto meta = extract_page_metadata(html, "https://fallback.test/");
    assert(meta["title"] == "T");
    assert(meta["description"] == "Desc & more");
    assert(meta["canonical"] == "https://example.org/canon");
    assert(meta["charset"] == "utf-8");
    const auto& ld = meta["json_ld"];
    assert(ld.size() == 2);
    assert(ld[0]["@type"] == "Article");
    assert(ld[1]["@type"] == "NewsArticle");
    // og:description is the fallback when description is absent.
    assert(extract_page_metadata(R"(<meta content="OG" property="og:description">)")["description"] == "OG");

    const auto links = extract_links(
        R"(<body><a name="top">Top</a><a class=x HREF='/a?x=1'>A <b>bold</b></a><a href=/b>B</a ><a href="https://c.test/">C</a></body>)",
        "https://example.org/", 100);
    assert(links.size() == 3);
    assert(links[0].href == "/a?x=1" && links[0].absolute == "https://example.org/a?x=1" && links[0].text == "A bold");
    assert(links[1].href == "/b" && links[1].absolute == "https://example.org/b" && links[1].text == "B");
    assert(links[2].href == "https://c.test/" && links[2].absolute == "https://c.test/" && links[2].text == "C");

    const auto text = extract_text(
        "<body><p>before</p><script>evil()</script ><p>middle</p><style>x{}</style\t\n foo><p>after</p>"
        "<SCRIPT>bad()</SCRIPT></body>");
    assert(text == "before middle after");
    std::cout << "test_html_metadata_order_and_case_variants ok\n";
}

void test_readme_headings_linear() {
    const auto md = to_readme_markdown(
        "T", "", "# One\n\n#### Four\n##NoSpace\n###   Three  \r\n## Two\nbody");
    assert(md.find("## Contents\n\n- One\n- Three\n- Two\n") != std::string::npos);
    assert(md.find("\n# One\n") == std::string::npos);  // duplicate leading title dropped
    const auto sourced = to_readme_markdown("T", "", "Source: https://x.test/\n\nbody");
    assert(sourced.find("Source:") == std::string::npos);
    assert(sourced.find("body") != std::string::npos);

    assert_fast("headings", [&] {
        return to_readme_markdown("T", "", "#" + repeat(" ", kRunRepeat) + std::string(1, '\0'));
    });
    assert_fast("title line", [&] { return to_readme_markdown("T", "", "#" + repeat(" ", kRunRepeat)); });
    assert_fast("source line", [&] {
        return to_readme_markdown("T", "", "Source:" + repeat(" ", kRunRepeat) + "x");
    });
    assert_fast("many headings", [&] {
        return to_readme_markdown("T", "", repeat("## h\n", kRedosRepeat));
    });
    std::cout << "test_readme_headings_linear ok\n";
}

void test_resolve_url_rejects_script_schemes() {
    for (const std::string href : {
             std::string("javascript:alert(1)"),
             std::string(" JaVaScRiPt:alert(1)"),
             std::string("java\tscript:alert(1)"),
             std::string("\x01javascript:x"),
             std::string("data:text/html,<script>alert(1)</script>"),
             std::string("DATA:text/html;base64,AAAA"),
             std::string("vbscript:msgbox(1)"),
             std::string(" VBScript:x"),
         }) {
        assert(resolve_url("https://example.org/", href).empty());
    }
    assert(resolve_url("https://example.org/a/", "b") == "https://example.org/a/b");
    assert(resolve_url("https://example.org/", "mailto:x@example.org") == "mailto:x@example.org");
    assert(resolve_url("https://example.org/", "https://other.test/p") == "https://other.test/p");
    assert(resolve_url("https://example.org/", "/data:not-a-scheme") == "https://example.org/data:not-a-scheme");

    // Unsafe links never get an absolute URL, so the explorer never queues them.
    const auto links = extract_links(
        R"(<body><a href="data:text/html,x">D</a><a href=" VBScript:x">V</a>)"
        "<a href=\"java\tscript:x\">J</a><a href=\"/ok\">OK</a></body>",
        "https://example.org/", 100);
    assert(links.size() == 4);
    for (std::size_t i = 0; i < 3; ++i) assert(links[i].absolute.empty());
    assert(links[3].absolute == "https://example.org/ok");
    std::cout << "test_resolve_url_rejects_script_schemes ok\n";
}

int main() {
    test_html_extraction_linear_on_pathological_attributes();
    test_html_metadata_order_and_case_variants();
    test_readme_headings_linear();
    test_resolve_url_rejects_script_schemes();
    test_html_extract();
    test_html_to_markdown_tool();
    test_url_and_host_policy();
    test_policy_json_roundtrip();
    test_fetch_and_explore_fixture();
    test_depth_zero_vs_depth_one();
    test_tools_registry();
    test_noise_strip_pathological_nesting();
    std::cout << "All web explorer tests passed\n";
    return 0;
}
