#include <handoffkit/demos/fusion/algo_stats.hpp>
#include <algorithm>
#include <cmath>
#include <numeric>
namespace handoffkit { namespace demos { namespace fusion {
namespace {
double sqr(double x){ return x*x; }
}

double mean(const std::vector<double>& x) {
  if (x.empty()) return 0; double s=0; for(double v:x) s+=v; return s/x.size();
}
double variance(const std::vector<double>& x, bool sample) {
  if (x.size()<2) return 0; double m=mean(x); double s=0; for(double v:x) s+=sqr(v-m);
  return s / (sample? (x.size()-1) : x.size());
}
double stddev(const std::vector<double>& x, bool sample) { return std::sqrt(variance(x,sample)); }
double median(std::vector<double> x) {
  if (x.empty()) return 0; std::sort(x.begin(), x.end());
  size_t n=x.size(); if (n%2) return x[n/2]; return 0.5*(x[n/2-1]+x[n/2]);
}
double percentile(std::vector<double> x, double p) {
  if (x.empty()) return 0; if (p<=0) return *std::min_element(x.begin(),x.end());
  if (p>=100) return *std::max_element(x.begin(),x.end());
  std::sort(x.begin(), x.end());
  double r = (p/100.0) * (x.size()-1); size_t i=(size_t)r; double f=r-i;
  if (i+1>=x.size()) return x.back(); return x[i]*(1-f)+x[i+1]*f;
}
double min_v(const std::vector<double>& x){ if(x.empty())return 0; return *std::min_element(x.begin(),x.end()); }
double max_v(const std::vector<double>& x){ if(x.empty())return 0; return *std::max_element(x.begin(),x.end()); }
double sum_v(const std::vector<double>& x){ double s=0; for(double v:x)s+=v; return s; }
double cosine_similarity(const std::vector<double>& a, const std::vector<double>& b) {
  size_t n=std::min(a.size(),b.size()); if(!n) return 0; double dot=0,na=0,nb=0;
  for(size_t i=0;i<n;++i){ dot+=a[i]*b[i]; na+=sqr(a[i]); nb+=sqr(b[i]); }
  if (na<=0||nb<=0) return 0; return dot/(std::sqrt(na)*std::sqrt(nb));
}
double pearson(const std::vector<double>& a, const std::vector<double>& b) {
  size_t n=std::min(a.size(),b.size()); if(n<2) return 0;
  double ma=0,mb=0; for(size_t i=0;i<n;++i){ ma+=a[i]; mb+=b[i]; } ma/=n; mb/=n;
  double num=0,da=0,db=0; for(size_t i=0;i<n;++i){ double xa=a[i]-ma, xb=b[i]-mb; num+=xa*xb; da+=xa*xa; db+=xb*xb; }
  if (da<=0||db<=0) return 0; return num/std::sqrt(da*db);
}
static std::vector<double> ranks(std::vector<double> x) {
  size_t n=x.size(); std::vector<size_t> idx(n); for(size_t i=0;i<n;++i) idx[i]=i;
  std::sort(idx.begin(), idx.end(), [&](size_t i, size_t j){ return x[i]<x[j]; });
  std::vector<double> r(n); for(size_t rank=0; rank<n; ++rank) r[idx[rank]] = double(rank+1);
  return r;
}
double spearman(std::vector<double> a, std::vector<double> b) {
  size_t n=std::min(a.size(),b.size()); a.resize(n); b.resize(n); return pearson(ranks(a), ranks(b));
}
double mae(const std::vector<double>& a, const std::vector<double>& b) {
  size_t n=std::min(a.size(),b.size()); if(!n) return 0; double s=0; for(size_t i=0;i<n;++i) s+=std::abs(a[i]-b[i]); return s/n;
}
double rmse(const std::vector<double>& a, const std::vector<double>& b) {
  size_t n=std::min(a.size(),b.size()); if(!n) return 0; double s=0; for(size_t i=0;i<n;++i) s+=sqr(a[i]-b[i]); return std::sqrt(s/n);
}
double kl_divergence(const std::vector<double>& p, const std::vector<double>& q) {
  size_t n=std::min(p.size(),q.size()); double s=0; for(size_t i=0;i<n;++i){ if(p[i]<=0) continue; double qq=std::max(q[i],1e-12); s+=p[i]*std::log(p[i]/qq); } return s;
}
std::vector<double> softmax(const std::vector<double>& x) {
  if (x.empty()) return {}; double m=max_v(x); std::vector<double> e(x.size()); double s=0;
  for(size_t i=0;i<x.size();++i){ e[i]=std::exp(x[i]-m); s+=e[i]; }
  if (s<=0) return e; for(double& v:e) v/=s; return e;
}
std::vector<double> normalize_l1(const std::vector<double>& x) {
  double s=0; for(double v:x) s+=std::abs(v); std::vector<double> y=x; if(s<=0) return y; for(double& v:y) v/=s; return y;
}
std::vector<double> normalize_l2(const std::vector<double>& x) {
  double s=0; for(double v:x) s+=sqr(v); s=std::sqrt(s); std::vector<double> y=x; if(s<=0) return y; for(double& v:y) v/=s; return y;
}
std::vector<int> histogram(const std::vector<double>& x, int bins, double lo, double hi) {
  if (bins<1) bins=1; std::vector<int> h(bins,0); if (hi<=lo) return h;
  for (double v:x) {
    if (v<lo||v>hi) continue; int b = (int)((v-lo)/(hi-lo)*bins); if (b==bins) b=bins-1; if(b>=0&&b<bins) h[b]++;
  }
  return h;
}
double entropy(const std::vector<double>& probs) {
  double s=0; for(double p:probs){ if(p>0) s -= p*std::log2(p); } return s;
}
nlohmann::json summarize_vector(const std::vector<double>& x) {
  return nlohmann::json{
    {"n",(int)x.size()},{"mean",mean(x)},{"stddev",stddev(x)},{"median",median(x)},
    {"min",min_v(x)},{"max",max_v(x)},{"p90",percentile(x,90)},{"p99",percentile(x,99)},
  };
}
nlohmann::json compare_metric_vectors(const std::vector<double>& a, const std::vector<double>& b) {
  return nlohmann::json{
    {"cosine", cosine_similarity(a,b)}, {"pearson", pearson(a,b)}, {"spearman", spearman(a,b)},
    {"mae", mae(a,b)}, {"rmse", rmse(a,b)},
    {"a", summarize_vector(a)}, {"b", summarize_vector(b)},
  };
}

}}}
