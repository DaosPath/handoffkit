#include <handoffkit/ml/cuda/runtime.hpp>

#include <string>
#include <vector>

#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
#include <cuda_runtime.h>
#endif

namespace handoffkit {
namespace ml {
namespace cuda_rt {
namespace {

#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
thread_local std::string g_err;

void set_err(cudaError_t e) {
    if (e == cudaSuccess) g_err.clear();
    else g_err = cudaGetErrorString(e);
}

bool check(cudaError_t e) {
    set_err(e);
    return e == cudaSuccess;
}
#endif

}  // namespace

bool compiled() {
#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
    return true;
#else
    return false;
#endif
}

bool available() {
#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
    int n = 0;
    if (cudaGetDeviceCount(&n) != cudaSuccess) return false;
    return n > 0;
#else
    return false;
#endif
}

int device_count() {
#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
    int n = 0;
    if (cudaGetDeviceCount(&n) != cudaSuccess) return 0;
    return n;
#else
    return 0;
#endif
}

std::vector<DeviceProps> list_devices() {
    std::vector<DeviceProps> out;
#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
    int n = device_count();
    for (int i = 0; i < n; ++i) {
        cudaDeviceProp p{};
        if (cudaGetDeviceProperties(&p, i) != cudaSuccess) continue;
        DeviceProps d;
        d.index = i;
        d.name = p.name ? p.name : "unknown";
        d.major = p.major;
        d.minor = p.minor;
        d.total_mem = static_cast<std::size_t>(p.totalGlobalMem);
        out.push_back(std::move(d));
    }
#endif
    return out;
}

std::string status_note() {
#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
    if (!available()) {
        return "CUDA compiled (own kernels, cudart only, no cuBLAS); no device visible";
    }
    auto devs = list_devices();
    if (devs.empty()) return "CUDA compiled; device list empty";
    return "CUDA own-kernels ready; device0=" + devs[0].name + " sm_" +
           std::to_string(devs[0].major) + std::to_string(devs[0].minor);
#else
    return "Build with -DHANDOFFKIT_ML_CUDA=ON (cudart + own .cu kernels; no cuBLAS)";
#endif
}

void* device_alloc(std::size_t bytes) {
#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
    void* p = nullptr;
    if (!check(cudaMalloc(&p, bytes))) return nullptr;
    return p;
#else
    (void)bytes;
    return nullptr;
#endif
}

void device_free(void* p) {
#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
    if (p) check(cudaFree(p));
#else
    (void)p;
#endif
}

void copy_h2d(void* dst, const void* src, std::size_t bytes) {
#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
    check(cudaMemcpy(dst, src, bytes, cudaMemcpyHostToDevice));
#else
    (void)dst;
    (void)src;
    (void)bytes;
#endif
}

void copy_d2h(void* dst, const void* src, std::size_t bytes) {
#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
    check(cudaMemcpy(dst, src, bytes, cudaMemcpyDeviceToHost));
#else
    (void)dst;
    (void)src;
    (void)bytes;
#endif
}

void copy_d2d(void* dst, const void* src, std::size_t bytes) {
#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
    check(cudaMemcpy(dst, src, bytes, cudaMemcpyDeviceToDevice));
#else
    (void)dst;
    (void)src;
    (void)bytes;
#endif
}

void device_memset_zero(void* p, std::size_t bytes) {
#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
    check(cudaMemset(p, 0, bytes));
#else
    (void)p;
    (void)bytes;
#endif
}

void device_sync() {
#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
    check(cudaDeviceSynchronize());
#endif
}

std::string last_error() {
#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
    return g_err;
#else
    return {};
#endif
}

}  // namespace cuda_rt
}  // namespace ml
}  // namespace handoffkit
