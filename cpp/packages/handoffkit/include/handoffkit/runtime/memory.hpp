#pragma once

#include <nlohmann/json.hpp>

#include <cstddef>
#include <string>
#include <utility>
#include <vector>

namespace handoffkit {

struct MemoryEntry {
    std::string role;
    std::string content;
    nlohmann::json metadata = nlohmann::json::object();

    nlohmann::json to_json() const {
        return nlohmann::json{
            {"role", role},
            {"content", content},
            {"metadata", metadata.is_null() ? nlohmann::json::object() : metadata},
        };
    }
};

/// Append-only in-memory history for an agent (sync, offline).
class AgentMemory {
public:
    MemoryEntry& add(std::string role, std::string content, nlohmann::json metadata = nlohmann::json::object()) {
        entries_.push_back(MemoryEntry{
            std::move(role),
            std::move(content),
            metadata.is_null() ? nlohmann::json::object() : std::move(metadata),
        });
        return entries_.back();
    }

    [[nodiscard]] std::vector<MemoryEntry> last(std::size_t count = 5) const {
        if (count == 0 || entries_.empty()) {
            return {};
        }
        if (count >= entries_.size()) {
            return entries_;
        }
        return std::vector<MemoryEntry>(entries_.end() - static_cast<std::ptrdiff_t>(count), entries_.end());
    }

    [[nodiscard]] std::string to_text(std::size_t count = 5) const {
        std::string out;
        for (const auto& entry : last(count)) {
            if (!out.empty()) {
                out.push_back('\n');
            }
            out += entry.role;
            out += ": ";
            out += entry.content;
        }
        return out;
    }

    void clear() { entries_.clear(); }

    [[nodiscard]] const std::vector<MemoryEntry>& entries() const noexcept { return entries_; }
    [[nodiscard]] std::size_t size() const noexcept { return entries_.size(); }

    nlohmann::json to_json() const {
        nlohmann::json arr = nlohmann::json::array();
        for (const auto& e : entries_) {
            arr.push_back(e.to_json());
        }
        return arr;
    }

private:
    std::vector<MemoryEntry> entries_;
};

}  // namespace handoffkit
