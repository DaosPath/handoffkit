#pragma once

#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <random>
#include <stdexcept>
#include <string>
#include <vector>

namespace handoffkit {
namespace ml {

enum class Device : std::uint8_t { Cpu = 0, Cuda = 1 };

enum class DType : std::uint8_t { F32 = 0 };

/// Contiguous row-major f32 tensor (CPU always; CUDA storage reserved for F4).
class Tensor {
public:
    std::vector<std::size_t> shape;
    std::vector<float> data;
    Device device = Device::Cpu;
    DType dtype = DType::F32;

    Tensor() = default;
    explicit Tensor(std::vector<std::size_t> sh, Device dev = Device::Cpu)
        : shape(std::move(sh)), device(dev) {
        data.assign(numel(), 0.f);
    }

    [[nodiscard]] std::size_t ndim() const { return shape.size(); }
    [[nodiscard]] std::size_t numel() const {
        if (shape.empty()) return 0;
        std::size_t n = 1;
        for (auto d : shape) n *= d;
        return n;
    }
    [[nodiscard]] bool empty() const { return numel() == 0; }

    float& operator[](std::size_t i) { return data[i]; }
    const float& operator[](std::size_t i) const { return data[i]; }

    float& at(std::size_t i) {
        if (i >= data.size()) throw std::out_of_range("tensor index");
        return data[i];
    }
    const float& at(std::size_t i) const {
        if (i >= data.size()) throw std::out_of_range("tensor index");
        return data[i];
    }

    void fill(float v) {
        for (auto& x : data) x = v;
    }

    void zero() { fill(0.f); }

    /// Uniform [-scale, scale]
    void uniform(float scale, std::mt19937& rng) {
        std::uniform_real_distribution<float> dist(-scale, scale);
        for (auto& x : data) x = dist(rng);
    }

    /// Xavier/Glorot-ish for matrix (rows, cols)
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
        t.device = device;
        t.dtype = dtype;
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
            throw std::runtime_error("op requires CPU tensor (device=cuda not active)");
        }
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
