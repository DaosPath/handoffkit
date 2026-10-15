#include <handoffkit/ml/csp_worker.hpp>
#include <handoffkit/ml/version.hpp>

#include <iostream>
#include <stdexcept>
#include <string>

int main() {
#ifndef HANDOFFKIT_ML_WITH_CSP
    throw std::runtime_error("installed cpp-ml package lacks HK-CSP integration");
#endif
    if (std::string(handoffkit::ml::version()) != "0.6.0") {
        throw std::runtime_error("cpp-ml package version metadata mismatch");
    }
    const auto capabilities = handoffkit::ml::detect_ml_worker_capabilities("consumer", 1);
    if (capabilities.runtime != "cpp-ml") {
        throw std::runtime_error("cpp-ml CSP worker capability probe failed");
    }
    std::cout << "handoffkit-ml " << handoffkit::ml::version()
              << " installed consumer OK\n";
}
