#include <handoffkit/runtime/http_provider.hpp>

#include <cassert>
#include <iostream>
#include <string>

using namespace handoffkit;

namespace {

void test_parse_openai_chat_completion_message() {
    nlohmann::json response = {
        {"id", "chatcmpl-test"},
        {"choices", nlohmann::json::array({
            nlohmann::json{
                {"index", 0},
                {"message", {{"role", "assistant"}, {"content", "Hello from fixture"}}},
                {"finish_reason", "stop"},
            },
        })},
    };
    auto text = parse_openai_chat_completion(response);
    assert(text);
    assert(text.value() == "Hello from fixture");
    std::cout << "test_parse_openai_chat_completion_message passed!" << std::endl;
}

void test_parse_openai_chat_completion_text_fallback() {
    nlohmann::json response = {
        {"choices", nlohmann::json::array({
            nlohmann::json{{"text", "legacy text path"}},
        })},
    };
    auto text = parse_openai_chat_completion(response);
    assert(text);
    assert(text.value() == "legacy text path");
    std::cout << "test_parse_openai_chat_completion_text_fallback passed!" << std::endl;
}

void test_parse_openai_rejects_reasoning_without_final_content() {
    nlohmann::json response = {
        {"choices", nlohmann::json::array({
            nlohmann::json{
                {"message", {
                    {"role", "assistant"},
                    {"content", ""},
                    {"reasoning_content", "still reasoning"},
                }},
                {"finish_reason", "length"},
            },
        })},
    };
    auto result = parse_openai_chat_completion(response);
    assert(!result);
    assert(result.error().code == ErrorCode::ParseError);
    assert(result.error().message.find("increase max_tokens") != std::string::npos);
    std::cout << "test_parse_openai_rejects_reasoning_without_final_content passed!" << std::endl;
}

void test_parse_openai_rejects_empty_choices() {
    auto bad = parse_openai_chat_completion(nlohmann::json{{"choices", nlohmann::json::array()}});
    assert(!bad);
    assert(bad.error().code == ErrorCode::ParseError);
    std::cout << "test_parse_openai_rejects_empty_choices passed!" << std::endl;
}

void test_build_openai_chat_request_shape() {
    GenerateOptions opts;
    opts.agent_name = "Coder";
    opts.context = "prior context";
    opts.max_tokens = 2048;
    opts.temperature = 0.2;
    opts.top_p = 0.9;
    opts.extra_body = {{"thinking", {{"type", "disabled"}}}, {"custom_flag", true}};
    auto body = build_openai_chat_request("gpt-test", "do work", opts);
    assert(body.at("model") == "gpt-test");
    assert(body.at("messages").is_array());
    assert(body.at("messages").size() == 1);
    assert(body.at("messages")[0].at("role") == "user");
    std::string content = body.at("messages")[0].at("content").get<std::string>();
    assert(content.find("prior context") != std::string::npos);
    assert(content.find("do work") != std::string::npos);
    assert(body.at("user") == "Coder");
    assert(body.at("max_tokens") == 2048);
    assert(body.at("temperature") == 0.2);
    assert(body.at("top_p") == 0.9);
    assert(body.at("thinking").at("type") == "disabled");
    assert(body.at("custom_flag") == true);
    std::cout << "test_build_openai_chat_request_shape passed!" << std::endl;
}

}  // namespace

int main() {
    test_parse_openai_chat_completion_message();
    test_parse_openai_chat_completion_text_fallback();
    test_parse_openai_rejects_reasoning_without_final_content();
    test_parse_openai_rejects_empty_choices();
    test_build_openai_chat_request_shape();
    std::cout << "All HTTP parse (offline) tests passed!" << std::endl;
    return 0;
}
