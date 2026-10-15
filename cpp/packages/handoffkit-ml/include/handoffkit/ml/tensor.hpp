#pragma once

#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <random>
#include <stdexcept>
#include <string>
#include <vector>

#include <handoffkit/ml/cuda/runtime.hpp>

namespace handoffkit {
namespace ml {

enum class Device : std::uint8_t { Cpu = 0, Cuda = 1 };

enum class DType : std::uint8_t { F32 = 0 };

/// Contiguous row-major f32 tensor. Host vector always mirrors logical size;
/// when device==Cuda, device_data holds the authoritative values on GPU.
class Tensor {
public:
    std::vector<std::size_t> shape;
    std::vector<float> data;  // host buffer (always sized to numel)
    Device device = Device::Cpu;
    DType dtype = DType::F32;
    // CUDA storage (own allocator; no third-party)
    std::shared_ptr<float> device_data;

    Tensor() = default;

    explicit Tensor(std::vector<std::size_t> sh, Device dev = Device::Cpu) : shape(std::move(sh)), device(dev) {
        data.assign(numel(), 0.f);
        if (device == Device::Cuda) {
            ensure_device_alloc();
            if (device_data) {
                cuda_rt::device_memset_zero(device_data.get(), numel() * sizeof(float));
            }
        }
    }

    [[nodiscard]] std::size_t ndim() const { return shape.size(); }
    [[nodiscard]] std::size_t numel() const {
        if (shape.empty()) return 0;
        std::size_t n = 1;
        for (auto d : shape) n *= d;
        return n;
    }
    [[nodiscard]] bool empty() const { return numel() == 0; }

    float& operator[](std::size_t i) {
        require_cpu();
        return data[i];
    }
    const float& operator[](std::size_t i) const {
        require_cpu();
        return data[i];
    }

    float& at(std::size_t i) {
        require_cpu();
        if (i >= data.size()) throw std::out_of_range("tensor index");
        return data[i];
    }
    const float& at(std::size_t i) const {
        require_cpu();
        if (i >= data.size()) throw std::out_of_range("tensor index");
        return data[i];
    }

    void fill(float v) {
        if (device == Device::Cpu) {
            for (auto& x : data) x = v;
            return;
        }
        // device: fill via host then upload (simple; ok for init)
        for (auto& x : data) x = v;
        upload();
    }

    void zero() { fill(0.f); }

    void uniform(float scale, std::mt19937& rng) {
        std::uniform_real_distribution<float> dist(-scale, scale);
        for (auto& x : data) x = dist(rng);
        if (device == Device::Cuda) upload();
    }

    void xavier(std::mt19937& rng) {
        if (ndim() != 2) {
            uniform(0.02f, rng);
            return;
        }
        const float fan_in = static_cast<float>(shape[1]);
        const float fan_out = static_cast<float>(shape[0]);
        const float lim = std::sqrt(6.f / (fan_in + fan_out));
        uniform(lim, rng);
    }

    [[nodiscard]] Tensor clone() const {
        Tensor t;
        t.shape = shape;
        t.data = data;
        t.device = Device::Cpu;  // clone lands on host first
        t.dtype = dtype;
        if (device == Device::Cuda && device_data) {
            t.data.resize(numel());
            cuda_rt::copy_d2h(t.data.data(), device_data.get(), numel() * sizeof(float));
        }
        if (device == Device::Cuda) {
            t = t.to(Device::Cuda);
        }
        return t;
    }

    [[nodiscard]] Tensor zeros_like() const {
        Tensor t(shape, device);
        return t;
    }

    [[nodiscard]] std::string shape_str() const {
        std::string s = "[";
        for (std::size_t i = 0; i < shape.size(); ++i) {
            if (i) s += ',';
            s += std::to_string(shape[i]);
        }
        s += ']';
        return s;
    }

    void require_cpu() const {
        if (device != Device::Cpu) {
            throw std::runtime_error("op requires CPU tensor (call .to(Device::Cpu) first)");
        }
    }

    void require_cuda() const {
        if (device != Device::Cuda) {
            throw std::runtime_error("op requires CUDA tensor");
        }
        if (!device_data) throw std::runtime_error("CUDA tensor missing device_data");
    }

    void ensure_device_alloc() {
        if (device != Device::Cuda) return;
        if (!cuda_rt::available()) {
            throw std::runtime_error("CUDA not available: " + cuda_rt::status_note());
        }
        if (device_data) return;
        const std::size_t bytes = numel() * sizeof(float);
        void* p = cuda_rt::device_alloc(bytes);
        if (!p) throw std::runtime_error("cudaMalloc failed: " + cuda_rt::last_error());
        device_data = std::shared_ptr<float>(static_cast<float*>(p), [](float* ptr) {
            cuda_rt::device_free(ptr);
        });
    }

    void upload() {
        if (device != Device::Cuda) return;
        ensure_device_alloc();
        if (numel()) {
            cuda_rt::copy_h2d(device_data.get(), data.data(), numel() * sizeof(float));
        }
    }

    void download() {
        if (device != Device::Cuda || !device_data) return;
        data.resize(numel());
        if (numel()) {
            cuda_rt::copy_d2h(data.data(), device_data.get(), numel() * sizeof(float));
        }
    }

    /// Move/copy tensor to target device (new Tensor).
    [[nodiscard]] Tensor to(Device dev) const {
        if (dev == device) {
            return clone_same_device();
        }
        if (dev == Device::Cpu) {
            Tensor t;
            t.shape = shape;
            t.dtype = dtype;
            t.device = Device::Cpu;
            t.data = data;
            if (device == Device::Cuda && device_data) {
                t.data.resize(numel());
                cuda_rt::copy_d2h(t.data.data(), device_data.get(), numel() * sizeof(float));
            }
            return t;
        }
        // to CUDA
        if (!cuda_rt::compiled()) {
            throw std::runtime_error("CUDA not compiled; rebuild with -DHANDOFFKIT_ML_CUDA=ON");
        }
        if (!cuda_rt::available()) {
            throw std::runtime_error("CUDA not available: " + cuda_rt::status_note());
        }
        Tensor t;
        t.shape = shape;
        t.dtype = dtype;
        t.device = Device::Cuda;
        t.data = data;
        if (device == Device::Cuda && device_data) {
            t.data.resize(numel());
            cuda_rt::copy_d2h(t.data.data(), device_data.get(), numel() * sizeof(float));
        }
        t.ensure_device_alloc();
        t.upload();
        return t;
    }

    [[nodiscard]] float* device_ptr() {
        require_cuda();
        return device_data.get();
    }
    [[nodiscard]] const float* device_ptr() const {
        require_cuda();
        return device_data.get();
    }

private:
    [[nodiscard]] Tensor clone_same_device() const {
        Tensor t;
        t.shape = shape;
        t.data = data;
        t.device = device;
        t.dtype = dtype;
        if (device == Device::Cuda) {
            t.ensure_device_alloc();
            if (device_data && t.device_data && numel()) {
                cuda_rt::copy_d2d(t.device_data.get(), device_data.get(), numel() * sizeof(float));
            }
        }
        return t;
    }
};

[[nodiscard]] inline Tensor zeros(std::vector<std::size_t> sh, Device d = Device::Cpu) {
    return Tensor(std::move(sh), d);
}

[[nodiscard]] inline Tensor ones(std::vector<std::size_t> sh, Device d = Device::Cpu) {
    Tensor t(std::move(sh), d);
    t.fill(1.f);
    return t;
}

}  // namespace ml
}  // namespace handoffkit
