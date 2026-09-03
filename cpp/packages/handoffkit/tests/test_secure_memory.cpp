#include <handoffkit/csp/secure_memory.hpp>

#include <cassert>
#include <iostream>
#include <utility>

using namespace handoffkit::csp;

int main() {
    SecureBuffer buffer("sensitive-key-material");
    assert(!buffer.empty());
    assert(buffer.size() == 22);
    buffer.clear();
    assert(buffer.empty());
    SecureBuffer copied(std::string("copied-secret"));
    assert(copied.view() == "copied-secret");
    SecureBuffer moved_copy(std::move(copied));
    assert(moved_copy.view() == "copied-secret");
    assert(copied.empty());
    SecureBuffer moved(SecureBuffer(16));
    assert(moved.size() == 16);
    std::cout << "[PASS] scoped C++ secure buffer wipe and move-only ownership" << std::endl;
    return 0;
}
