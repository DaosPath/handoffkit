#include <handoffkit/ml/ops.hpp>

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <thread>
#include <vector>

#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
extern "C" bool handoffkit_ml_cuda_matmul(const float* A, const float* B, float* C, int M, int K,
                                          int N);
#endif

namespace handoffkit {
namespace ml {
namespace {

void check_same_shape(const Tensor& a, const Tensor& b, const char* op) {
    if (a.shape != b.shape) {
        throw std::runtime_error(std::string(op) + " shape mismatch " + a.shape_str() + " vs " +
                                 b.shape_str());
    }
}

}  // namespace

Tensor add(const Tensor& a, const Tensor& b) {
    a.require_cpu();
    b.require_cpu();
    check_same_shape(a, b, "add");
    Tensor o = a.clone();
    for (std::size_t i = 0; i < o.numel(); ++i) o.data[i] += b.data[i];
    return o;
}

void add_inplace(Tensor& a, const Tensor& b) {
    a.require_cpu();
    b.require_cpu();
    check_same_shape(a, b, "add_inplace");
    for (std::size_t i = 0; i < a.numel(); ++i) a.data[i] += b.data[i];
}

Tensor mul(const Tensor& a, const Tensor& b) {
    a.require_cpu();
    b.require_cpu();
    check_same_shape(a, b, "mul");
    Tensor o = a.clone();
    for (std::size_t i = 0; i < o.numel(); ++i) o.data[i] *= b.data[i];
    return o;
}

Tensor mul_scalar(const Tensor& a, float s) {
    a.require_cpu();
    Tensor o = a.clone();
    for (auto& x : o.data) x *= s;
    return o;
}

Tensor sub(const Tensor& a, const Tensor& b) {
    a.require_cpu();
    b.require_cpu();
    check_same_shape(a, b, "sub");
    Tensor o = a.clone();
    for (std::size_t i = 0; i < o.numel(); ++i) o.data[i] -= b.data[i];
    return o;
}

Tensor matmul(const Tensor& a, const Tensor& b) {
    // Real train path uses multi-thread CPU (and CUDA when HANDOFFKIT_ML_WITH_CUDA + runtime).
    a.require_cpu();
    b.require_cpu();
    if (a.ndim() != 2 || b.ndim() != 2) throw std::runtime_error("matmul needs 2D");
    const int M = static_cast<int>(a.shape[0]);
    const int K = static_cast<int>(a.shape[1]);
    const int K2 = static_cast<int>(b.shape[0]);
    const int N = static_cast<int>(b.shape[1]);
    if (K != K2) throw std::runtime_error("matmul inner dim mismatch");

    Tensor o({static_cast<std::size_t>(M), static_cast<std::size_t>(N)});

#if defined(HANDOFFKIT_ML_WITH_CUDA) && HANDOFFKIT_ML_WITH_CUDA
    // Own tiled GEMM via cudart only (no cuBLAS) — see src/cuda/gemm.cu
    if (handoffkit_ml_cuda_matmul(a.data.data(), b.data.data(), o.data.data(), M, K, N)) {
        return o;
    }
#endif

    // Multi-thread CPU fallback
    unsigned hw = std::thread::hardware_concurrency();
    int threads = hw == 0 ? 2 : static_cast<int>(hw);
    threads = std::max(1, std::min(threads, M));
    auto worker = [&](int r0, int r1) {
        for (int i = r0; i < r1; ++i) {
            for (int j = 0; j < N; ++j) {
                float s = 0.f;
                for (int k = 0; k < K; ++k) {
                    s += a.data[static_cast<std::size_t>(i * K + k)] *
                         b.data[static_cast<std::size_t>(k * N + j)];
                }
                o.data[static_cast<std::size_t>(i * N + j)] = s;
            }
        }
    };
    if (threads == 1 || M < 8) {
        worker(0, M);
        return o;
    }
    std::vector<std::thread> pool;
    int chunk = (M + threads - 1) / threads;
    for (int t = 0; t < threads; ++t) {
        int r0 = t * chunk;
        int r1 = std::min(M, r0 + chunk);
        if (r0 >= r1) break;
        pool.emplace_back(worker, r0, r1);
    }
    for (auto& th : pool) th.join();
    return o;
}

Tensor transpose2d(const Tensor& a) {
    a.require_cpu();
    if (a.ndim() != 2) throw std::runtime_error("transpose2d needs 2D");
    const std::size_t R = a.shape[0], C = a.shape[1];
    Tensor o({C, R});
    for (std::size_t i = 0; i < R; ++i)
        for (std::size_t j = 0; j < C; ++j) o.data[j * R + i] = a.data[i * C + j];
    return o;
}

Tensor relu(const Tensor& x) {
    x.require_cpu();
    Tensor o = x.clone();
    for (auto& v : o.data) v = v > 0.f ? v : 0.f;
    return o;
}

Tensor gelu(const Tensor& x) {
    x.require_cpu();
    // 0.5 * x * (1 + tanh(sqrt(2/pi)*(x+0.044715*x^3)))
    constexpr float k = 0.7978845608f;  // sqrt(2/pi)
    Tensor o = x.clone();
    for (std::size_t i = 0; i < o.numel(); ++i) {
        const float v = x.data[i];
        const float u = k * (v + 0.044715f * v * v * v);
        o.data[i] = 0.5f * v * (1.f + std::tanh(u));
    }
    return o;
}

Tensor softmax_rows(const Tensor& x) {
    x.require_cpu();
    if (x.ndim() != 2) throw std::runtime_error("softmax_rows needs 2D");
    const std::size_t B = x.shape[0], C = x.shape[1];
    Tensor o({B, C});
    for (std::size_t i = 0; i < B; ++i) {
        float m = x.data[i * C];
        for (std::size_t j = 1; j < C; ++j) m = std::max(m, x.data[i * C + j]);
        float sum = 0.f;
        for (std::size_t j = 0; j < C; ++j) {
            o.data[i * C + j] = std::exp(x.data[i * C + j] - m);
            sum += o.data[i * C + j];
        }
        for (std::size_t j = 0; j < C; ++j) o.data[i * C + j] /= sum;
    }
    return o;
}

Tensor log_softmax_rows(const Tensor& x) {
    auto s = softmax_rows(x);
    for (auto& v : s.data) v = std::log(std::max(v, 1e-20f));
    return s;
}

float mean_all(const Tensor& x) {
    if (x.empty()) return 0.f;
    return sum_all(x) / static_cast<float>(x.numel());
}

float sum_all(const Tensor& x) {
    x.require_cpu();
    float s = 0.f;
    for (float v : x.data) s += v;
    return s;
}

float cross_entropy_mean(const Tensor& logits, const std::vector<int>& targets) {
    logits.require_cpu();
    if (logits.ndim() != 2) throw std::runtime_error("ce needs 2D logits");
    const std::size_t B = logits.shape[0], C = logits.shape[1];
    if (targets.size() != B) throw std::runtime_error("ce targets size");
    auto logp = log_softmax_rows(logits);
    float loss = 0.f;
    for (std::size_t i = 0; i < B; ++i) {
        int t = targets[i];
        if (t < 0 || static_cast<std::size_t>(t) >= C) throw std::runtime_error("ce target OOB");
        loss += -logp.data[i * C + static_cast<std::size_t>(t)];
    }
    return loss / static_cast<float>(B);
}

LinearBackward linear_backward(const Tensor& x, const Tensor& W, const Tensor& dy, bool has_bias) {
    // y = x @ W^T + b; W (out,in), x (B,in), dy (B,out)
    x.require_cpu();
    W.require_cpu();
    dy.require_cpu();
    if (x.ndim() != 2 || W.ndim() != 2 || dy.ndim() != 2) {
        throw std::runtime_error("linear_backward ranks");
    }
    const std::size_t B = x.shape[0], In = x.shape[1], Out = W.shape[0];
    if (W.shape[1] != In || dy.shape[0] != B || dy.shape[1] != Out) {
        throw std::runtime_error("linear_backward shapes");
    }
    LinearBackward r;
    // dW = dy^T @ x  -> (out,in)
    r.dW = matmul(transpose2d(dy), x);
    // dx = dy @ W -> (B,in)
    r.dx = matmul(dy, W);
    r.db = zeros({Out});
    if (has_bias) {
        for (std::size_t j = 0; j < Out; ++j) {
            float s = 0.f;
            for (std::size_t i = 0; i < B; ++i) s += dy.data[i * Out + j];
            r.db.data[j] = s;
        }
    }
    return r;
}

Tensor relu_backward(const Tensor& x, const Tensor& dy) {
    check_same_shape(x, dy, "relu_backward");
    Tensor dx = dy.clone();
    for (std::size_t i = 0; i < dx.numel(); ++i) {
        if (x.data[i] <= 0.f) dx.data[i] = 0.f;
    }
    return dx;
}

Tensor gelu_backward(const Tensor& x, const Tensor& dy) {
    check_same_shape(x, dy, "gelu_backward");
    constexpr float k = 0.7978845608f;
    Tensor dx = dy.clone();
    for (std::size_t i = 0; i < x.numel(); ++i) {
        const float v = x.data[i];
        const float u = k * (v + 0.044715f * v * v * v);
        const float th = std::tanh(u);
        const float sech2 = 1.f - th * th;
        const float du = k * (1.f + 3.f * 0.044715f * v * v);
        const float dgelu = 0.5f * (1.f + th) + 0.5f * v * sech2 * du;
        dx.data[i] = dy.data[i] * dgelu;
    }
    return dx;
}

Tensor softmax_ce_backward(const Tensor& logits, const std::vector<int>& targets) {
    // dL/dlogits = (softmax - onehot) / B
    auto p = softmax_rows(logits);
    const std::size_t B = p.shape[0], C = p.shape[1];
    Tensor d = p.clone();
    for (std::size_t i = 0; i < B; ++i) {
        int t = targets[i];
        d.data[i * C + static_cast<std::size_t>(t)] -= 1.f;
        for (std::size_t j = 0; j < C; ++j) d.data[i * C + j] /= static_cast<float>(B);
    }
    return d;
}

float gradcheck_scalar(const std::vector<float>& x0,
                       const std::vector<float>& analytic_grad,
                       ScalarFn f,
                       float eps) {
    if (x0.size() != analytic_grad.size()) throw std::runtime_error("gradcheck size");
    float max_err = 0.f;
    std::vector<float> x = x0;
    for (std::size_t i = 0; i < x0.size(); ++i) {
        x[i] = x0[i] + eps;
        const float fp = f(x);
        x[i] = x0[i] - eps;
        const float fm = f(x);
        x[i] = x0[i];
        const float num = (fp - fm) / (2.f * eps);
        const float err = std::fabs(num - analytic_grad[i]);
        if (err > max_err) max_err = err;
    }
    return max_err;
}

bool gradcheck_matmul(float tol) {
    // loss = sum(A @ B); dA = ones(M,N) @ B^T
    Tensor A({2, 3});
    Tensor B({3, 4});
    std::mt19937 rng(0);
    A.uniform(0.5f, rng);
    B.uniform(0.5f, rng);
    Tensor Y = matmul(A, B);
    Tensor dY({2, 4});
    dY.fill(1.f);
    // dA = dY @ B^T
    Tensor dA = matmul(dY, transpose2d(B));
    // numeric
    float max_err = 0.f;
    const float eps = 1e-3f;
    for (std::size_t i = 0; i < A.numel(); ++i) {
        A.data[i] += eps;
        float fp = sum_all(matmul(A, B));
        A.data[i] -= 2.f * eps;
        float fm = sum_all(matmul(A, B));
        A.data[i] += eps;
        float num = (fp - fm) / (2.f * eps);
        max_err = std::max(max_err, std::fabs(num - dA.data[i]));
    }
    return max_err < tol;
}

float gradcheck_linear_ce(float eps) {
    // Single linear: logits = x @ W^T, loss = CE
    const int B = 2, In = 3, Out = 4;
    Tensor x({static_cast<std::size_t>(B), static_cast<std::size_t>(In)});
    Tensor W({static_cast<std::size_t>(Out), static_cast<std::size_t>(In)});
    std::mt19937 rng(1);
    x.uniform(0.3f, rng);
    W.uniform(0.3f, rng);
    std::vector<int> targets = {1, 2};
    Tensor logits = matmul(x, transpose2d(W));
    Tensor dlog = softmax_ce_backward(logits, targets);
    auto bw = linear_backward(x, W, dlog, false);
    float max_err = 0.f;
    for (std::size_t i = 0; i < W.numel(); ++i) {
        W.data[i] += eps;
        float fp = cross_entropy_mean(matmul(x, transpose2d(W)), targets);
        W.data[i] -= 2.f * eps;
        float fm = cross_entropy_mean(matmul(x, transpose2d(W)), targets);
        W.data[i] += eps;
        float num = (fp - fm) / (2.f * eps);
        max_err = std::max(max_err, std::fabs(num - bw.dW.data[i]));
    }
    return max_err;
}

}  // namespace ml
}  // namespace handoffkit
