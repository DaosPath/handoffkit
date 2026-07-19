#pragma once

#include <handoffkit/ml/cuda/runtime.hpp>
#include <handoffkit/ml/tensor.hpp>

#include <string>

namespace handoffkit {
namespace ml {

struct DeviceInfo {
    bool cpu = true;
    bool cuda_compiled = false;
    bool cuda_available = false;
    int cuda_devices = 0;
    std::string cuda_note;
    std::string device0_name;
};

inline DeviceInfo query_devices() {
    DeviceInfo d;
    d.cpu = true;
    d.cuda_compiled = cuda_rt::compiled();
    d.cuda_available = cuda_rt::available();
    d.cuda_devices = cuda_rt::device_count();
    d.cuda_note = cuda_rt::status_note();
    auto list = cuda_rt::list_devices();
    if (!list.empty()) d.device0_name = list[0].name;
    return d;
}

inline Tensor to_device(const Tensor& t, Device dev) {
    return t.to(dev);
}

}  // namespace ml
}  // namespace handoffkit
