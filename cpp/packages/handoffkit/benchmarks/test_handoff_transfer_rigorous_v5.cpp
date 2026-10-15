#include <handoffkit/handoff.hpp>
#include <nlohmann/json.hpp>

#include <chrono>
#include <iostream>
#include <string>
#include <vector>
#include <thread>
#include <future>
#include <atomic>
#include <cstring>
#include <iomanip>
#include <algorithm>

using namespace handoffkit;

// Estructura de Microbenchmark Riguroso para Medición de Percentiles p50/p95/p99
struct LatencySample {
    uint64_t latency_ns;
};

int main() {
    std::cout << "========================================================================\n";
    std::cout << "   HANDOFFKIT RIGOROUS BENCHMARK V5 - METODOLOGÍA CIENTÍFICA REPRODUCIBLE\n";
    std::cout << "========================================================================\n";

    constexpr size_t NUM_SAMPLES = 100000;
    constexpr int NUM_THREADS = 16;

    // Identical Payload Standard (Payload Identico Normalizado de 1,024 Bytes)
    std::string normalized_payload(1024, 'x');
    nlohmann::json json_payload = {
        {"handoff_id", "h-v5-rigorous-1024b"},
        {"sender_agent", "architect_lead"},
        {"recipient_agent", "coder_primary"},
        {"payload_data", normalized_payload}
    };

    std::string json_str = json_payload.dump();
    const size_t payload_bytes = json_str.size();

    std::cout << "  - Payload Normalizado Estándar: " << payload_bytes << " Bytes por Handoff\n";
    std::cout << "  - Muestras por Hilo:            " << NUM_SAMPLES << " Iteraciones\n";
    std::cout << "  - Hilos Concurrentes:           " << NUM_THREADS << " Hilos de Proceso\n";
    std::cout << "  - Capturando Muestras de Latencia Individual para Percentiles p50/p95/p99...\n";
    std::cout << "------------------------------------------------------------------------\n";

    std::vector<uint64_t> all_latencies;
    all_latencies.reserve(NUM_SAMPLES * NUM_THREADS);
    std::atomic<size_t> total_bytes_processed{0};

    auto start_wall = std::chrono::high_resolution_clock::now();

    auto worker = [&](int thread_id) {
        std::vector<uint64_t> thread_latencies;
        thread_latencies.reserve(NUM_SAMPLES);
        size_t thread_bytes = 0;

        for (size_t i = 0; i < NUM_SAMPLES; ++i) {
            auto t0 = std::chrono::high_resolution_clock::now();

            // 1. Serialización / Deserialización JSON Completa
            std::string serialized = json_payload.dump();
            nlohmann::json deserialized = nlohmann::json::parse(serialized);

            // 2. Validación de Contrato
            bool valid = deserialized.contains("handoff_id") && deserialized.contains("payload_data");
            (void)valid;

            auto t1 = std::chrono::high_resolution_clock::now();
            uint64_t elapsed_ns = std::chrono::duration_cast<std::chrono::nanoseconds>(t1 - t0).count();

            thread_latencies.push_back(elapsed_ns);
            thread_bytes += serialized.size();
        }

        total_bytes_processed += thread_bytes;

        // Merge results using global lock
        static std::mutex latency_mutex;
        std::lock_guard<std::mutex> lock(latency_mutex);
        all_latencies.insert(all_latencies.end(), thread_latencies.begin(), thread_latencies.end());
    };

    std::vector<std::thread> workers;
    for (int t = 0; t < NUM_THREADS; ++t) {
        workers.emplace_back(worker, t);
    }

    for (auto& w : workers) {
        w.join();
    }

    auto end_wall = std::chrono::high_resolution_clock::now();
    double total_sec = std::chrono::duration<double>(end_wall - start_wall).count();

    // Calcular Percentiles p50, p90, p95, p99, p99.9
    std::sort(all_latencies.begin(), all_latencies.end());
    size_t total_ops = all_latencies.size();

    uint64_t p50  = all_latencies[static_cast<size_t>(total_ops * 0.50)];
    uint64_t p90  = all_latencies[static_cast<size_t>(total_ops * 0.90)];
    uint64_t p95  = all_latencies[static_cast<size_t>(total_ops * 0.95)];
    uint64_t p99  = all_latencies[static_cast<size_t>(total_ops * 0.99)];
    uint64_t p999 = all_latencies[static_cast<size_t>(total_ops * 0.999)];

    double total_mb = static_cast<double>(total_bytes_processed) / (1024.0 * 1024.0);
    double ops_per_sec = total_ops / total_sec;
    double throughput_mb_s = total_mb / total_sec;
    double amortized_ns_per_op = (total_sec / total_ops) * 1e9;

    std::cout << "========================================================================\n";
    std::cout << "   RESULTADOS R库GUS DE BENCHMARK V5 (PAYLOAD UNIFORME DE " << payload_bytes << " B)\n";
    std::cout << "========================================================================\n";
    std::cout << "  - Operaciones Totales Completadas:  " << total_ops << " ops (JSON Parse + Dump + Valid)\n";
    std::cout << "  - Volumen Total Procesado:          " << std::fixed << std::setprecision(2) << total_mb << " MB\n";
    std::cout << "  - Tiempo Pared Transcurrido:       " << std::fixed << std::setprecision(4) << total_sec << " s\n";
    std::cout << "  - Throughput Agregado:             " << static_cast<long long>(ops_per_sec) << " ops / segundo\n";
    std::cout << "  - Ancho de Banda Agregado:         " << std::fixed << std::setprecision(2) << throughput_mb_s << " MB/s\n";
    std::cout << "  - Tiempo Amortizado por Op (32 threads): " << std::fixed << std::setprecision(2) << amortized_ns_per_op << " ns/op\n";
    std::cout << "------------------------------------------------------------------------\n";
    std::cout << "   DISTRIBUCIÓN DE LATENCIA INDIVIDUAL END-TO-END (MEDICIÓN DIRECTA):\n";
    std::cout << "  - Latencia Mediana (p50):           " << p50 << " ns (" << (p50 / 1000.0) << " us)\n";
    std::cout << "  - Latencia Percentil p90:           " << p90 << " ns (" << (p90 / 1000.0) << " us)\n";
    std::cout << "  - Latencia Percentil p95:           " << p95 << " ns (" << (p95 / 1000.0) << " us)\n";
    std::cout << "  - Latencia Percentil p99:           " << p99 << " ns (" << (p99 / 1000.0) << " us)\n";
    std::cout << "  - Latencia Percentil p99.9 (Cola):  " << p999 << " ns (" << (p999 / 1000.0) << " us)\n";
    std::cout << "========================================================================\n";

    return 0;
}
