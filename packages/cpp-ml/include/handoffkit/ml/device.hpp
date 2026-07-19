#pragma once

#include <handoffkit/ml/tensor.hpp>

#include <stdexcept>
#include <string>

namespace handoffkit {
namespace ml {

/// F4: device abstraction. CPU always available; CUDA is opt-in compile flag.
struct DeviceInfo {
    bool cpu = true;
    bool cuda_compiled = false;
    bool cuda_available = false;
    std::string cuda_note;
};

inline DeviceInfo query_devices() {
    DeviceInfo d;
    d.cpu = true;
#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
    d.cuda_compiled = true;
    // Runtime detection would go here (cudaGetDeviceCount). Without linking CUDA,
    // report compiled-but-not-runtime-linked in F4 scaffolding.
    d.cuda_available = false;
    d.cuda_note = "HANDOFFKIT_ML_WITH_CUDA=ON: CUDA runtime path not linked in this build "
                  "(CPU fallback). Provide CUDA toolkit + implement kernels to enable.";
#else
    d.cuda_compiled = false;
    d.cuda_available = false;
    d.cuda_note = "Build with -DHANDOFFKIT_ML_CUDA=ON to enable CUDA compile path (F4).";
#endif
    return d;
}

/// Move tensor to device (F4: only CPU implemented; Cuda copies fall back with error).
inline Tensor to_device(const Tensor& t, Device dev) {
    if (dev == Device::Cpu) {
        Tensor o = t.clone();
        o.device = Device::Cpu;
        return o;
    }
    if (dev == Device::Cuda) {
#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
        // Placeholder: real cudaMalloc/copy in later kernel work.
        throw std::runtime_error("CUDA device transfer not implemented; use CPU");
#else
        throw std::runtime_error("CUDA not compiled; rebuild with HANDOFFKIT_ML_CUDA=ON");
#endif
    }
    return t.clone();
}

}  // namespace ml
}  // namespace handoffkit
