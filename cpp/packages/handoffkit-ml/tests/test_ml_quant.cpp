#include <handoffkit/ml/device.hpp>
#include <handoffkit/ml/quant.hpp>

#include <cassert>
#include <cmath>
#include <iostream>
#include <random>

int main() {
    using namespace handoffkit::ml;
    Tensor t({8});
    std::mt19937 rng(1);
    t.uniform(2.f, rng);
    auto q = quantize_int8(t);
    assert(q.cfg.scheme == "int8");
    auto d = dequantize_int8(q);
    float err = 0.f;
    for (std::size_t i = 0; i < t.numel(); ++i) err = std::max(err, std::fabs(t.data[i] - d.data[i]));
    std::cout << "int8 max_err=" << err << "\n";
    assert(err < 0.05f);

    auto dev = query_devices();
    assert(dev.cpu);
    assert(dist_available());
    assert(dist_status().find("cpu_sim") != std::string::npos);
    assert(dist_status().find("NCCL backends unavailable") != std::string::npos);

#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
    // A CUDA build must exercise a real device transfer on the configured GPU.
    auto cuda = to_device(t, Device::Cuda);
    assert(cuda.device == Device::Cuda);
    assert(cuda.device_data != nullptr);
    auto roundtrip = cuda.to(Device::Cpu);
    assert(roundtrip.device == Device::Cpu);
    assert(roundtrip.data.size() == t.data.size());
#else
    // A CPU-only build must fail closed instead of pretending CUDA support.
    bool threw = false;
    try {
        to_device(t, Device::Cuda);
    } catch (...) {
        threw = true;
    }
    assert(threw);
#endif

    std::cout << "test_ml_quant ok\n";
    return 0;
}
