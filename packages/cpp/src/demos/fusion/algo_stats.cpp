#include <handoffkit/demos/fusion/algo_stats.hpp>

#include <algorithm>
#include <cmath>
#include <numeric>

namespace handoffkit {
namespace demos {
namespace fusion {
namespace {

double sqr(double x) { return x * x; }

std::vector<double> ranks(std::vector<double> x) {
    const std::size_t n = x.size();
    std::vector<std::size_t> idx(n);
    for (std::size_t i = 0; i < n; ++i) idx[i] = i;
    std::sort(idx.begin(), idx.end(), [&](std::size_t i, std::size_t j) {
        return x[i] < x[j];
    });
    std::vector<double> result(n);
    for (std::size_t rank = 0; rank < n; ++rank) {
        result[idx[rank]] = static_cast<double>(rank + 1);
    }
    return result;
}

}  // namespace

double mean(const std::vector<double>& x) {
    if (x.empty()) return 0.0;
    return std::accumulate(x.begin(), x.end(), 0.0) / static_cast<double>(x.size());
}

double variance(const std::vector<double>& x, bool sample) {
    if (x.size() < 2) return 0.0;
    const double m = mean(x);
    double sum = 0.0;
    for (double value : x) sum += sqr(value - m);
    const std::size_t divisor = sample ? x.size() - 1 : x.size();
    return sum / static_cast<double>(divisor);
}

double stddev(const std::vector<double>& x, bool sample) {
    return std::sqrt(variance(x, sample));
}

double median(std::vector<double> x) {
    if (x.empty()) return 0.0;
    std::sort(x.begin(), x.end());
    const std::size_t n = x.size();
    if (n % 2 != 0) return x[n / 2];
    return 0.5 * (x[n / 2 - 1] + x[n / 2]);
}

double percentile(std::vector<double> x, double p) {
    if (x.empty()) return 0.0;
    if (p <= 0.0) return *std::min_element(x.begin(), x.end());
    if (p >= 100.0) return *std::max_element(x.begin(), x.end());
    std::sort(x.begin(), x.end());
    const double rank = (p / 100.0) * static_cast<double>(x.size() - 1);
    const std::size_t index = static_cast<std::size_t>(rank);
    const double fraction = rank - static_cast<double>(index);
    if (index + 1 >= x.size()) return x.back();
    return x[index] * (1.0 - fraction) + x[index + 1] * fraction;
}

double min_v(const std::vector<double>& x) {
    return x.empty() ? 0.0 : *std::min_element(x.begin(), x.end());
}

double max_v(const std::vector<double>& x) {
    return x.empty() ? 0.0 : *std::max_element(x.begin(), x.end());
}

double sum_v(const std::vector<double>& x) {
    return std::accumulate(x.begin(), x.end(), 0.0);
}

double cosine_similarity(const std::vector<double>& a, const std::vector<double>& b) {
    const std::size_t n = std::min(a.size(), b.size());
    if (n == 0) return 0.0;
    double dot = 0.0;
    double norm_a = 0.0;
    double norm_b = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        dot += a[i] * b[i];
        norm_a += sqr(a[i]);
        norm_b += sqr(b[i]);
    }
    if (norm_a <= 0.0 || norm_b <= 0.0) return 0.0;
    return dot / (std::sqrt(norm_a) * std::sqrt(norm_b));
}

double pearson(const std::vector<double>& a, const std::vector<double>& b) {
    const std::size_t n = std::min(a.size(), b.size());
    if (n < 2) return 0.0;
    double mean_a = 0.0;
    double mean_b = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        mean_a += a[i];
        mean_b += b[i];
    }
    mean_a /= static_cast<double>(n);
    mean_b /= static_cast<double>(n);
    double numerator = 0.0;
    double denom_a = 0.0;
    double denom_b = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        const double da = a[i] - mean_a;
        const double db = b[i] - mean_b;
        numerator += da * db;
        denom_a += da * da;
        denom_b += db * db;
    }
    if (denom_a <= 0.0 || denom_b <= 0.0) return 0.0;
    return numerator / std::sqrt(denom_a * denom_b);
}

double spearman(std::vector<double> a, std::vector<double> b) {
    const std::size_t n = std::min(a.size(), b.size());
    a.resize(n);
    b.resize(n);
    return pearson(ranks(std::move(a)), ranks(std::move(b)));
}

double mae(const std::vector<double>& a, const std::vector<double>& b) {
    const std::size_t n = std::min(a.size(), b.size());
    if (n == 0) return 0.0;
    double sum = 0.0;
    for (std::size_t i = 0; i < n; ++i) sum += std::abs(a[i] - b[i]);
    return sum / static_cast<double>(n);
}

double rmse(const std::vector<double>& a, const std::vector<double>& b) {
    const std::size_t n = std::min(a.size(), b.size());
    if (n == 0) return 0.0;
    double sum = 0.0;
    for (std::size_t i = 0; i < n; ++i) sum += sqr(a[i] - b[i]);
    return std::sqrt(sum / static_cast<double>(n));
}

double kl_divergence(const std::vector<double>& p, const std::vector<double>& q) {
    const std::size_t n = std::min(p.size(), q.size());
    double sum = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        if (p[i] <= 0.0) continue;
        const double safe_q = std::max(q[i], 1e-12);
        sum += p[i] * std::log(p[i] / safe_q);
    }
    return sum;
}

std::vector<double> softmax(const std::vector<double>& x) {
    if (x.empty()) return {};
    const double max_value = max_v(x);
    std::vector<double> result(x.size());
    double sum = 0.0;
    for (std::size_t i = 0; i < x.size(); ++i) {
        result[i] = std::exp(x[i] - max_value);
        sum += result[i];
    }
    if (sum <= 0.0) return result;
    for (double& value : result) value /= sum;
    return result;
}

std::vector<double> normalize_l1(const std::vector<double>& x) {
    double norm = 0.0;
    for (double value : x) norm += std::abs(value);
    std::vector<double> result = x;
    if (norm <= 0.0) return result;
    for (double& value : result) value /= norm;
    return result;
}

std::vector<double> normalize_l2(const std::vector<double>& x) {
    double norm = 0.0;
    for (double value : x) norm += sqr(value);
    norm = std::sqrt(norm);
    std::vector<double> result = x;
    if (norm <= 0.0) return result;
    for (double& value : result) value /= norm;
    return result;
}

std::vector<int> histogram(const std::vector<double>& x, int bins, double lo, double hi) {
    if (bins < 1) bins = 1;
    std::vector<int> result(static_cast<std::size_t>(bins), 0);
    if (hi <= lo) return result;
    for (double value : x) {
        if (value < lo || value > hi) continue;
        int bin = static_cast<int>((value - lo) / (hi - lo) * bins);
        if (bin == bins) bin = bins - 1;
        if (bin >= 0 && bin < bins) ++result[static_cast<std::size_t>(bin)];
    }
    return result;
}

double entropy(const std::vector<double>& probs) {
    double result = 0.0;
    for (double probability : probs) {
        if (probability > 0.0) result -= probability * std::log2(probability);
    }
    return result;
}

nlohmann::json summarize_vector(const std::vector<double>& x) {
    return nlohmann::json{
        {"n", static_cast<int>(x.size())},
        {"mean", mean(x)},
        {"stddev", stddev(x)},
        {"median", median(x)},
        {"min", min_v(x)},
        {"max", max_v(x)},
        {"p90", percentile(x, 90)},
        {"p99", percentile(x, 99)},
    };
}

nlohmann::json compare_metric_vectors(
    const std::vector<double>& a,
    const std::vector<double>& b
) {
    return nlohmann::json{
        {"cosine", cosine_similarity(a, b)},
        {"pearson", pearson(a, b)},
        {"spearman", spearman(a, b)},
        {"mae", mae(a, b)},
        {"rmse", rmse(a, b)},
        {"a", summarize_vector(a)},
        {"b", summarize_vector(b)},
    };
}

}  // namespace fusion
}  // namespace demos
}  // namespace handoffkit
