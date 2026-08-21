#include <handoffkit/demos/fusion/prompt.hpp>
#include <array>
#include <cstdint>
namespace handoffkit { namespace demos { namespace fusion {
namespace {
// Explicit CP1252-ish punctuation map used by extended sanitize helpers.
struct MapEntry { unsigned char from; char to; const char* name; };
constexpr std::array<MapEntry, 16> kPunctMap = {{
  {0x91, '\'', "lsquo"}, {0x92, '\'', "rsquo"}, {0x93, '"', "ldquo"}, {0x94, '"', "rdquo"},
  {0x96, '-', "ndash"}, {0x97, '-', "mdash"}, {0x85, '.', "ellipsis"}, {0xA0, ' ', "nbsp"},
  {0x80, 'E', "euro_ish"}, {0x82, ',', "low9"}, {0x84, '"', "low99"}, {0x86, '+', "dagger_ish"},
  {0x87, '+', "ddagger_ish"}, {0x89, '%', "permille_ish"}, {0x8B, '<', "lsaquo"}, {0x9B, '>', "rsaquo"},
}};
} // namespace

char map_windows_punct_byte(unsigned char c) {
  for (const auto& e : kPunctMap) if (e.from == c) return e.to;
  if (c < 0x20 && c!='\n' && c!='\r' && c!='\t') return ' ';
  return static_cast<char>(c);
}

std::string describe_punct_maps() {
  std::string s;
  for (const auto& e : kPunctMap) {
    s += e.name; s += ":"; s.push_back(e.to); s += ";";
  }
  return s;
}

// Public test-facing wrapper already uses sanitize_prompt_text; this file deepens mapping coverage.
std::string sanitize_with_named_maps(std::string_view input) {
  std::string tmp;
  tmp.reserve(input.size());
  for (unsigned char c : input) {
    if (c < 0x80) tmp.push_back(map_windows_punct_byte(c));
    else tmp.push_back(map_windows_punct_byte(c));
  }
  return sanitize_prompt_text(tmp, true);
}

}}}
