#include <handoffkit/demos/fusion/cache.hpp>

#include <sstream>

namespace handoffkit {
namespace demos {
namespace fusion {

// Extra human-readable helpers for cache stats (CLI / reports).

std::string format_cache_stats_markdown(const FusionCacheStats& s) {
    std::ostringstream ss;
    ss << "## Fusion cache stats\n\n"
       << "| metric | value |\n|---|---:|\n"
       << "| hits | " << s.hits << " |\n"
       << "| misses | " << s.misses << " |\n"
       << "| puts | " << s.puts << " |\n"
       << "| evictions | " << s.evictions << " |\n"
       << "| disk_reads | " << s.disk_reads << " |\n"
       << "| disk_writes | " << s.disk_writes << " |\n"
       << "| corrupt_rejects | " << s.corrupt_rejects << " |\n"
       << "| memory_entries | " << s.memory_entries << " |\n"
       << "| memory_bytes | " << s.memory_bytes << " |\n"
       << "| hit_rate | " << s.hit_rate() << " |\n";
    return ss.str();
}

std::string format_cache_stats_text(const FusionCacheStats& s) {
    std::ostringstream ss;
    ss << "hits=" << s.hits
       << " misses=" << s.misses
       << " puts=" << s.puts
       << " evictions=" << s.evictions
       << " disk_reads=" << s.disk_reads
       << " disk_writes=" << s.disk_writes
       << " corrupt_rejects=" << s.corrupt_rejects
       << " memory_entries=" << s.memory_entries
       << " memory_bytes=" << s.memory_bytes
       << " hit_rate=" << s.hit_rate();
    return ss.str();
}

bool cache_stats_healthy(const FusionCacheStats& s) {
    if (s.corrupt_rejects > 0 && s.hits == 0 && s.puts == 0) return false;
    if (s.hit_rate() < 0.0 || s.hit_rate() > 1.0) return false;
    return true;
}

nlohmann::json cache_stats_delta(const FusionCacheStats& before, const FusionCacheStats& after) {
    return nlohmann::json{
        {"hits", after.hits - before.hits},
        {"misses", after.misses - before.misses},
        {"puts", after.puts - before.puts},
        {"evictions", after.evictions - before.evictions},
        {"disk_reads", after.disk_reads - before.disk_reads},
        {"disk_writes", after.disk_writes - before.disk_writes},
        {"corrupt_rejects", after.corrupt_rejects - before.corrupt_rejects},
    };
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
