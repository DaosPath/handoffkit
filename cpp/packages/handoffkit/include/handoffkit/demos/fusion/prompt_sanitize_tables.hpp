#pragma once
#include <string>
#include <string_view>
namespace handoffkit { namespace demos { namespace fusion {
char map_windows_punct_byte(unsigned char c);
std::string describe_punct_maps();
std::string sanitize_with_named_maps(std::string_view input);
}}}
