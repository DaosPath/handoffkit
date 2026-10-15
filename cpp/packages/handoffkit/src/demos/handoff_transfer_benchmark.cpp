#include <handoffkit/handoff.hpp>
#include <nlohmann/json.hpp>

#include <chrono>
#include <iostream>
#include <string>
#include <vector>

using namespace handoffkit;

int main() {
    std::cout << "========================================================\n";
    std::cout << "   HANDOFFKIT C++ NATIVE TRANSFER BENCHMARK V1          \n";
    std::cout << "========================================================\n";

    nlohmann::json sample_payload = {
        {"handoff_id", "h-cpp-9901"},
        {"sender_agent", "architect_cpp"},
        {"recipient_agent", "coder_cpp"},
        {"session_state", {
            {"task_id", "t-cpp-task"},
            {"context_tokens_used", 14200},
            {"active_mode", "agenti_research"},
            {"verified_requirements", {"req_1_valid", "req_2_valid", "req_3_valid"}},
            {"environment_flags", {{"cuda", true}, {"cpp_version", 17}}}
        }},
        {"artifacts_transferred", {
            {{"filename", "ultra_browser.cpp"}, {"size_bytes", 10240}, {"checksum", "sha256_001a"}},
            {{"filename", "draco.cpp"}, {"size_bytes", 43314}, {"checksum", "sha256_002b"}}
        }},
        {"action_items", {
            {{"priority", "high"}, {"instruction", "Native C++ transfer loop"}, {"completed", true}}
        }}
    };

    constexpr int ITERATIONS = 100000;
    std::cout << "Ejecutando " << ITERATIONS << " transferencias C++ nativas...\n";

    auto start = std::chrono::high_resolution_clock::now();

    std::size_t total_bytes = 0;
    for (int i = 0; i < ITERATIONS; ++i) {
        std::string serialized = sample_payload.dump();
        total_bytes += serialized.size();
        nlohmann::json deserialized = nlohmann::json::parse(serialized);
        (void)deserialized;
    }

    auto end = std::chrono::high_resolution_clock::now();
    double total_sec = std::chrono::duration<double>(end - start).count();

    double handoffs_per_sec = ITERATIONS / total_sec;
    double throughput_mb_s = (static_cast<double>(total_bytes) / (1024.0 * 1024.0)) / total_sec;
    double avg_latency_us = (total_sec / ITERATIONS) * 1000000.0;

    std::cout << "--------------------------------------------------------\n";
    std::cout << "Transferencias Totales C++:  " << ITERATIONS << "\n";
    std::cout << "Tiempo Total:                " << total_sec << " segundos\n";
    std::cout << "Velocidad de Transferencia:  " << static_cast<long long>(handoffs_per_sec) << " handoffs/segundo\n";
    std::cout << "Rendimiento (Throughput):     " << throughput_mb_s << " MB/s\n";
    std::cout << "Latencia Promedio:           " << avg_latency_us << " microsegundos\n";
    std::cout << "========================================================\n";

    return 0;
}
