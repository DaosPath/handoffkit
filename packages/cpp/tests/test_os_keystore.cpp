#include <handoffkit/csp/os_keystore.hpp>
#include <handoffkit/csp/security.hpp>

#include <cassert>
#include <chrono>
#include <iostream>
#include <string>

using namespace handoffkit::csp;

int main() {
    if (!OsKeyStore::available()) {
        bool rejected = false;
        try {
            OsKeyStore store(L"handoffkit-test-unavailable");
            store.put("secret");
        } catch (const SecurityError& error) {
            rejected = error.code() == "os_keystore_unavailable";
        }
        assert(rejected);
        std::cout << "[PASS] OS keystore unavailable path" << std::endl;
        return 0;
    }

    const auto target = std::wstring(L"HandoffKit.Test.") + std::to_wstring(
        std::chrono::steady_clock::now().time_since_epoch().count());
    OsKeyStore store(target);
    store.put("handoffkit-os-keystore-secret");
    assert(store.get() == "handoffkit-os-keystore-secret");
    store.erase();
    bool missing = false;
    try {
        (void)store.get();
    } catch (const SecurityError& error) {
        missing = error.code() == "os_keystore_entry_missing";
    }
    assert(missing);
    std::cout << "[PASS] provider-backed OS keystore put/get/delete" << std::endl;
    return 0;
}
