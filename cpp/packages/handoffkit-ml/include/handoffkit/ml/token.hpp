#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace handoffkit {
namespace ml {

/// Byte-level tokenizer (256 bytes + BOS/EOS/PAD). Pure C++, no Python.
class ByteTokenizer {
public:
    static constexpr int BOS = 256;
    static constexpr int EOS = 257;
    static constexpr int PAD = 258;
    static constexpr int VOCAB = 259;

    [[nodiscard]] std::vector<int> encode(const std::string& text, bool add_special = true) const {
        std::vector<int> ids;
        if (add_special) ids.push_back(BOS);
        for (unsigned char c : text) ids.push_back(static_cast<int>(c));
        if (add_special) ids.push_back(EOS);
        return ids;
    }

    [[nodiscard]] std::string decode(const std::vector<int>& ids) const {
        std::string s;
        for (int id : ids) {
            if (id >= 0 && id < 256) s.push_back(static_cast<char>(id));
        }
        return s;
    }
};

}  // namespace ml
}  // namespace handoffkit
