#pragma once

// Own CUDA runtime helpers — NVIDIA cudart only (no cuBLAS/cuDNN).

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace handoffkit {
namespace ml {
namespace cuda_rt {

struct DeviceProps {
    int index = 0;
    std::string name;
    int major = 0;
    int minor = 0;
    std::size_t total_mem = 0;
};

/// True if built with HANDOFFKIT_ML_WITH_CUDA and at least one device is visible.
[[nodiscard]] bool available();

[[nodiscard]] bool compiled();

[[nodiscard]] int device_count();

[[nodiscard]] std::vector<DeviceProps> list_devices();

[[nodiscard]] std::string status_note();

void* device_alloc(std::size_t bytes);
void device_free(void* p);
void copy_h2d(void* dst, const void* src, std::size_t bytes);
void copy_d2h(void* dst, const void* src, std::size_t bytes);
void copy_d2d(void* dst, const void* src, std::size_t bytes);
void device_memset_zero(void* p, std::size_t bytes);
void device_sync();

/// Last error string (empty if ok).
[[nodiscard]] std::string last_error();

}  // namespace cuda_rt
}  // namespace ml
}  // namespace handoffkit
