#pragma once

/// In-tree BPE tokenizer (C++ only). No Python / SentencePiece runtime required.
/// Trains merges from a corpus string and encode/decode UTF-8 as byte-level base
/// with learned merges (GPT-2 style byte BPE simplified).

#include <algorithm>
#include <cstdint>
#include <fstream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace handoffkit {
namespace ml {

struct BpeTokenizer {
    // id -> piece (bytes as string)
    std::vector<std::string> id_to_piece;
    std::unordered_map<std::string, int> piece_to_id;
    // merges in order: pair -> new_id
    std::vector<std::pair<std::string, std::string>> merges;
    int bos_id = -1;
    int eos_id = -1;
    int unk_id = -1;
    int pad_id = -1;

    [[nodiscard]] int vocab_size() const { return static_cast<int>(id_to_piece.size()); }

    void init_byte_base() {
        id_to_piece.clear();
        piece_to_id.clear();
        merges.clear();
        for (int i = 0; i < 256; ++i) {
            std::string s(1, static_cast<char>(static_cast<unsigned char>(i)));
            piece_to_id[s] = i;
            id_to_piece.push_back(s);
        }
        // specials
        bos_id = 256;
        eos_id = 257;
        unk_id = 258;
        pad_id = 259;
        auto add_special = [&](const std::string& name, int id) {
            while (static_cast<int>(id_to_piece.size()) <= id) id_to_piece.push_back("");
            id_to_piece[static_cast<std::size_t>(id)] = name;
            piece_to_id[name] = id;
        };
        add_special("<bos>", bos_id);
        add_special("<eos>", eos_id);
        add_special("<unk>", unk_id);
        add_special("<pad>", pad_id);
    }

    /// Train `num_merges` BPE merges on corpus (raw bytes).
    void train(const std::string& corpus, int num_merges) {
        init_byte_base();
        if (corpus.empty() || num_merges <= 0) return;

        // word = sequence of byte tokens for whole corpus as one stream chunked by spaces
        std::vector<std::vector<std::string>> words;
        {
            std::vector<std::string> cur;
            for (unsigned char c : corpus) {
                if (c == ' ' || c == '\n' || c == '\t') {
                    if (!cur.empty()) {
                        words.push_back(cur);
                        cur.clear();
                    }
                } else {
                    cur.emplace_back(1, static_cast<char>(c));
                }
            }
            if (!cur.empty()) words.push_back(cur);
        }
        if (words.empty()) {
            // fallback: whole corpus as one word of bytes
            std::vector<std::string> cur;
            for (unsigned char c : corpus) cur.emplace_back(1, static_cast<char>(c));
            words.push_back(std::move(cur));
        }

        for (int m = 0; m < num_merges; ++m) {
            std::map<std::pair<std::string, std::string>, int> counts;
            for (const auto& w : words) {
                for (std::size_t i = 0; i + 1 < w.size(); ++i) {
                    counts[{w[i], w[i + 1]}]++;
                }
            }
            if (counts.empty()) break;
            auto best = std::max_element(counts.begin(), counts.end(),
                                         [](const auto& a, const auto& b) {
                                             return a.second < b.second;
                                         });
            if (best->second < 2) break;
            const std::string& a = best->first.first;
            const std::string& b = best->first.second;
            const std::string merged = a + b;
            int new_id = static_cast<int>(id_to_piece.size());
            id_to_piece.push_back(merged);
            piece_to_id[merged] = new_id;
            merges.emplace_back(a, b);

            // apply merge
            for (auto& w : words) {
                std::vector<std::string> nw;
                for (std::size_t i = 0; i < w.size();) {
                    if (i + 1 < w.size() && w[i] == a && w[i + 1] == b) {
                        nw.push_back(merged);
                        i += 2;
                    } else {
                        nw.push_back(w[i]);
                        ++i;
                    }
                }
                w.swap(nw);
            }
        }
    }

    /// Encode raw bytes with merges (no BOS/EOS). Stable building block for prefix-safe SFT.
    [[nodiscard]] std::vector<int> encode_raw(const std::string& text) const {
        std::vector<std::string> toks;
        toks.reserve(text.size());
        for (unsigned char c : text) toks.emplace_back(1, static_cast<char>(c));
        for (const auto& pr : merges) {
            const std::string& a = pr.first;
            const std::string& b = pr.second;
            const std::string merged = a + b;
            std::vector<std::string> nt;
            nt.reserve(toks.size());
            for (std::size_t i = 0; i < toks.size();) {
                if (i + 1 < toks.size() && toks[i] == a && toks[i + 1] == b) {
                    nt.push_back(merged);
                    i += 2;
                } else {
                    nt.push_back(toks[i]);
                    ++i;
                }
            }
            toks.swap(nt);
        }
        std::vector<int> ids;
        ids.reserve(toks.size());
        for (const auto& t : toks) {
            auto it = piece_to_id.find(t);
            if (it == piece_to_id.end()) ids.push_back(unk_id >= 0 ? unk_id : 0);
            else ids.push_back(it->second);
        }
        return ids;
    }

    [[nodiscard]] std::vector<int> encode(const std::string& text, bool add_special = true) const {
        std::vector<int> ids;
        if (add_special && bos_id >= 0) ids.push_back(bos_id);
        auto raw = encode_raw(text);
        ids.insert(ids.end(), raw.begin(), raw.end());
        if (add_special && eos_id >= 0) ids.push_back(eos_id);
        return ids;
    }

    /// Prefix-safe SFT encoding: encode(prompt) then encode(completion) separately and
    /// concatenate so prompt tokens are always a prefix of full sequence (BPE merge boundaries
    /// never cross the prompt|completion cut).
    [[nodiscard]] std::vector<int> encode_sft(const std::string& prompt,
                                              const std::string& completion,
                                              bool add_special = true) const {
        std::vector<int> ids;
        if (add_special && bos_id >= 0) ids.push_back(bos_id);
        auto p = encode_raw(prompt);
        auto c = encode_raw(completion);
        ids.insert(ids.end(), p.begin(), p.end());
        ids.insert(ids.end(), c.begin(), c.end());
        if (add_special && eos_id >= 0) ids.push_back(eos_id);
        return ids;
    }

    [[nodiscard]] std::size_t prompt_token_len(const std::string& prompt, bool with_bos = true) const {
        std::size_t n = encode_raw(prompt).size();
        if (with_bos && bos_id >= 0) ++n;
        return n;
    }

    [[nodiscard]] std::string decode(const std::vector<int>& ids) const {
        std::string s;
        for (int id : ids) {
            if (id == bos_id || id == eos_id || id == pad_id || id == unk_id) continue;
            if (id < 0 || id >= static_cast<int>(id_to_piece.size())) continue;
            const std::string& p = id_to_piece[static_cast<std::size_t>(id)];
            if (p == "<bos>" || p == "<eos>" || p == "<unk>" || p == "<pad>") continue;
            s += p;
        }
        return s;
    }

    static std::string to_hex(const std::string& s) {
        static const char* hex = "0123456789abcdef";
        std::string o;
        o.reserve(s.size() * 2);
        for (unsigned char c : s) {
            o.push_back(hex[c >> 4]);
            o.push_back(hex[c & 0xf]);
        }
        return o;
    }
    static std::string from_hex(const std::string& h) {
        std::string o;
        o.reserve(h.size() / 2);
        auto val = [](char c) -> int {
            if (c >= '0' && c <= '9') return c - '0';
            if (c >= 'a' && c <= 'f') return c - 'a' + 10;
            if (c >= 'A' && c <= 'F') return c - 'A' + 10;
            return 0;
        };
        for (std::size_t i = 0; i + 1 < h.size(); i += 2) {
            o.push_back(static_cast<char>((val(h[i]) << 4) | val(h[i + 1])));
        }
        return o;
    }

    bool save(const std::string& path) const {
        std::ofstream o(path);
        if (!o) return false;
        o << "hk_bpe_v2\n";
        o << "vocab " << id_to_piece.size() << "\n";
        for (std::size_t i = 0; i < id_to_piece.size(); ++i) {
            o << i << " " << to_hex(id_to_piece[i]) << "\n";
        }
        o << "merges " << merges.size() << "\n";
        for (const auto& m : merges) {
            o << to_hex(m.first) << " " << to_hex(m.second) << "\n";
        }
        o << "specials " << bos_id << " " << eos_id << " " << unk_id << " " << pad_id << "\n";
        return static_cast<bool>(o);
    }

    static BpeTokenizer load(const std::string& path) {
        std::ifstream in(path);
        if (!in) throw std::runtime_error("cannot load bpe: " + path);
        BpeTokenizer t;
        std::string magic;
        std::getline(in, magic);
        if (magic.find("hk_bpe_v2") == std::string::npos && magic.find("hk_bpe_v1") == std::string::npos) {
            throw std::runtime_error("bad bpe magic");
        }
        std::string tag;
        int n = 0;
        in >> tag >> n;
        t.id_to_piece.assign(static_cast<std::size_t>(std::max(0, n)), "");
        for (int i = 0; i < n; ++i) {
            int id = 0;
            std::string hx;
            in >> id >> hx;
            std::string p = from_hex(hx);
            if (id >= 0 && id < n) {
                t.id_to_piece[static_cast<std::size_t>(id)] = p;
                t.piece_to_id[p] = id;
            }
        }
        int nm = 0;
        in >> tag >> nm;
        for (int i = 0; i < nm; ++i) {
            std::string ha, hb;
            in >> ha >> hb;
            t.merges.emplace_back(from_hex(ha), from_hex(hb));
        }
        in >> tag >> t.bos_id >> t.eos_id >> t.unk_id >> t.pad_id;
        if (!in && !in.eof()) throw std::runtime_error("corrupt bpe file: " + path);
        return t;
    }
};

/// Encode/decode roundtrip helper for tests.
inline bool bpe_roundtrip_ok(const std::string& corpus, const std::string& sample, int merges = 64) {
    BpeTokenizer t;
    t.train(corpus, merges);
    auto ids = t.encode(sample, false);
    auto dec = t.decode(ids);
    // Roundtrip for pure-ASCII without specials should match
    return dec == sample;
}

}  // namespace ml
}  // namespace handoffkit
