#include <handoffkit/ml/ml.hpp>
#include <handoffkit/ml/version.hpp>

#include <cassert>
#include <cstring>
#include <iostream>

int main() {
    assert(std::strcmp(handoffkit::ml::version(), HANDOFFKIT_ML_VERSION_STRING) == 0);
    assert(std::strlen(handoffkit::ml::phase()) > 0);
    assert(std::strlen(handoffkit::ml::status_message()) > 0);

    const auto cap = handoffkit::ml::capabilities();
    // F0: no training surface yet
    assert(!cap.tensor_cpu);
    assert(!cap.mini_transformer);
    assert(!cap.lora);
    assert(!cap.preference);

    std::cout << "test_ml_smoke ok version=" << handoffkit::ml::version()
              << " phase=" << handoffkit::ml::phase() << "\n";
    return 0;
}
