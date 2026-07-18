#include <handoffkit/demos/fusion/cache.hpp>
#include <handoffkit/demos/fusion/hash.hpp>
#include <handoffkit/demos/fusion/prompt.hpp>

#include <cassert>
#include <filesystem>
#include <iostream>

using namespace handoffkit::demos::fusion;

static std::filesystem::path scratch() {
#ifdef HANDOFFKIT_TEST_SCRATCH
    return std::filesystem::path(HANDOFFKIT_TEST_SCRATCH) / "fusion-cache";
#else
    return std::filesystem::temp_directory_path() / "handoffkit-fusion-cache-test";
#endif
}

void test_hash_stable() {
    const auto a = fusion_content_hash("hello");
    const auto b = fusion_content_hash("hello");
    assert(a == b);
    assert(a != fusion_content_hash("hello!"));
    const auto k = fusion_cache_key_hash("echo", "m", "r", "sys", "user", "neutral", "lean", 0.0);
    assert(k.size() >= 16);
    std::cout << "test_hash_stable ok\n";
}

void test_sanitize() {
    const std::string bom = "\xEF\xBB\xBF" "hi\x97there";
    const auto s = sanitize_prompt_text(bom, true);
    assert(s.find('\xEF') == std::string::npos);
    assert(s.find("hi") != std::string::npos);
    std::cout << "test_sanitize ok\n";
}

void test_memory_disk_cache() {
    const auto dir = scratch();
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);

    FusionCacheConfig cfg;
    cfg.cache_dir = dir;
    cfg.max_memory_entries = 4;
    cfg.max_memory_bytes = 1024;
    cfg.ttl_seconds = 3600;
    FusionCache cache(cfg);

    assert(cache.put("k1", "v1"));
    auto g = cache.get("k1");
    assert(g && g.value() == "v1");
    auto g2 = cache.get("k1");
    assert(g2 && g2.value() == "v1");
    assert(cache.stats().hits >= 2);

    // new cache instance reads from disk
    FusionCache cache2(cfg);
    auto g3 = cache2.get("k1");
    assert(g3 && g3.value() == "v1");

    assert(cache.clear_all());
    std::cout << "test_memory_disk_cache ok\n";
}

void test_lru_eviction() {
    FusionCacheConfig cfg;
    cfg.use_disk = false;
    cfg.max_memory_entries = 3;
    cfg.max_memory_bytes = 10 * 1024 * 1024;
    FusionCache cache(cfg);
    assert(cache.put("a", "1"));
    assert(cache.put("b", "2"));
    assert(cache.put("c", "3"));
    assert(cache.put("d", "4"));  // evict one
    assert(cache.stats().evictions >= 1);
    assert(cache.memory_size() <= 3);
    std::cout << "test_lru_eviction ok\n";
}

int main() {
    test_hash_stable();
    test_sanitize();
    test_memory_disk_cache();
    test_lru_eviction();
    std::cout << "All fusion cache tests passed\n";
    return 0;
}
