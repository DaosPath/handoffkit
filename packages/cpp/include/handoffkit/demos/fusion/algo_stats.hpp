#pragma once
#include <vector>
#include <nlohmann/json.hpp>
namespace handoffkit { namespace demos { namespace fusion {
double mean(const std::vector<double>& x);
double variance(const std::vector<double>& x, bool sample=true);
double stddev(const std::vector<double>& x, bool sample=true);
double median(std::vector<double> x);
double percentile(std::vector<double> x, double p);
double min_v(const std::vector<double>& x);
double max_v(const std::vector<double>& x);
double sum_v(const std::vector<double>& x);
double cosine_similarity(const std::vector<double>& a, const std::vector<double>& b);
double pearson(const std::vector<double>& a, const std::vector<double>& b);
double spearman(std::vector<double> a, std::vector<double> b);
double mae(const std::vector<double>& a, const std::vector<double>& b);
double rmse(const std::vector<double>& a, const std::vector<double>& b);
double kl_divergence(const std::vector<double>& p, const std::vector<double>& q);
std::vector<double> softmax(const std::vector<double>& x);
std::vector<double> normalize_l1(const std::vector<double>& x);
std::vector<double> normalize_l2(const std::vector<double>& x);
nlohmann::json summarize_vector(const std::vector<double>& x);
nlohmann::json compare_metric_vectors(const std::vector<double>& a, const std::vector<double>& b);
std::vector<int> histogram(const std::vector<double>& x, int bins, double lo, double hi);
double entropy(const std::vector<double>& probs);
}}}
