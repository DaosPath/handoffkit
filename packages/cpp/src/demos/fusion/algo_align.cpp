#include <handoffkit/demos/fusion/algo_align.hpp>
#include <handoffkit/demos/fusion/metrics.hpp>
#include <algorithm>
#include <cmath>
namespace handoffkit { namespace demos { namespace fusion {

nlohmann::json AlignScore::to_json() const {
  return nlohmann::json{
    {"score", score}, {"identity", identity},
    {"coverage_a", coverage_a}, {"coverage_b", coverage_b},
    {"aligned_a", aligned_a}, {"aligned_b", aligned_b},
  };
}

namespace {
struct Cell { int v=0; char t='x'; }; // t: d diagonal, u up, l left, z zero(local)
std::pair<std::string,std::string> traceback_nw(
  const std::vector<std::vector<Cell>>& dp, std::string_view a, std::string_view b) {
  std::string aa, bb;
  int i = (int)a.size(), j = (int)b.size();
  while (i>0 || j>0) {
    char t = dp[i][j].t;
    if (t=='d') { aa.push_back(a[i-1]); bb.push_back(b[j-1]); --i; --j; }
    else if (t=='u') { aa.push_back(a[i-1]); bb.push_back('-'); --i; }
    else if (t=='l') { aa.push_back('-'); bb.push_back(b[j-1]); --j; }
    else { break; }
  }
  std::reverse(aa.begin(), aa.end());
  std::reverse(bb.begin(), bb.end());
  return {aa,bb};
}
} // namespace

AlignScore needleman_wunsch(std::string_view a, std::string_view b, int match, int mismatch, int gap) {
  // Cap lengths for practical fusion branch compares
  if (a.size() > 800) a = a.substr(0, 800);
  if (b.size() > 800) b = b.substr(0, 800);
  const int n = (int)a.size(), m = (int)b.size();
  std::vector<std::vector<Cell>> dp(n+1, std::vector<Cell>(m+1));
  for (int i=1;i<=n;++i) { dp[i][0].v = i*gap; dp[i][0].t='u'; }
  for (int j=1;j<=m;++j) { dp[0][j].v = j*gap; dp[0][j].t='l'; }
  for (int i=1;i<=n;++i) {
    for (int j=1;j<=m;++j) {
      int s = (a[i-1]==b[j-1]) ? match : mismatch;
      int d = dp[i-1][j-1].v + s;
      int u = dp[i-1][j].v + gap;
      int l = dp[i][j-1].v + gap;
      if (d>=u && d>=l) { dp[i][j].v=d; dp[i][j].t='d'; }
      else if (u>=l) { dp[i][j].v=u; dp[i][j].t='u'; }
      else { dp[i][j].v=l; dp[i][j].t='l'; }
    }
  }
  AlignScore out;
  out.score = dp[n][m].v;
  auto ab = traceback_nw(dp, a, b);
  out.aligned_a = ab.first;
  out.aligned_b = ab.second;
  int same=0, cols=0;
  for (size_t k=0;k<out.aligned_a.size();++k) {
    if (out.aligned_a[k]=='-' || out.aligned_b[k]=='-') { ++cols; continue; }
    ++cols;
    if (out.aligned_a[k]==out.aligned_b[k]) ++same;
  }
  out.identity = cols? double(same)/cols : 0.0;
  out.coverage_a = n? double(n)/std::max(n,m) : 0.0;
  out.coverage_b = m? double(m)/std::max(n,m) : 0.0;
  return out;
}

AlignScore smith_waterman(std::string_view a, std::string_view b, int match, int mismatch, int gap) {
  if (a.size() > 800) a = a.substr(0, 800);
  if (b.size() > 800) b = b.substr(0, 800);
  const int n = (int)a.size(), m = (int)b.size();
  std::vector<std::vector<Cell>> dp(n+1, std::vector<Cell>(m+1));
  int best=0, bi=0, bj=0;
  for (int i=1;i<=n;++i) {
    for (int j=1;j<=m;++j) {
      int s = (a[i-1]==b[j-1]) ? match : mismatch;
      int d = dp[i-1][j-1].v + s;
      int u = dp[i-1][j].v + gap;
      int l = dp[i][j-1].v + gap;
      int v = std::max(0, std::max(d, std::max(u,l)));
      dp[i][j].v = v;
      if (v==0) dp[i][j].t='z';
      else if (v==d) dp[i][j].t='d';
      else if (v==u) dp[i][j].t='u';
      else dp[i][j].t='l';
      if (v>best) { best=v; bi=i; bj=j; }
    }
  }
  AlignScore out;
  out.score = best;
  // local traceback
  std::string aa, bb;
  int i=bi, j=bj;
  while (i>0 && j>0 && dp[i][j].v>0) {
    char t = dp[i][j].t;
    if (t=='d') { aa.push_back(a[i-1]); bb.push_back(b[j-1]); --i; --j; }
    else if (t=='u') { aa.push_back(a[i-1]); bb.push_back('-'); --i; }
    else if (t=='l') { aa.push_back('-'); bb.push_back(b[j-1]); --j; }
    else break;
  }
  std::reverse(aa.begin(), aa.end());
  std::reverse(bb.begin(), bb.end());
  out.aligned_a = aa; out.aligned_b = bb;
  int same=0, cols=0;
  for (size_t k=0;k<aa.size();++k) {
    if (aa[k]=='-'||bb[k]=='-') { ++cols; continue; }
    ++cols; if (aa[k]==bb[k]) ++same;
  }
  out.identity = cols? double(same)/cols : 0.0;
  out.coverage_a = n? double(aa.size())/n : 0.0;
  out.coverage_b = m? double(bb.size())/m : 0.0;
  return out;
}

AlignScore align_token_sequences(const std::vector<std::string>& ta, const std::vector<std::string>& tb) {
  // Map tokens to single-char alphabet for NW (hash to a-zA-Z0-9)
  auto pack = [](const std::vector<std::string>& t) {
    std::string s;
    for (const auto& x : t) {
      unsigned h = 0;
      for (unsigned char c: x) h = h*131u + c;
      s.push_back(static_cast<char>('!' + (h % 90)));
    }
    return s;
  };
  auto sa = pack(ta), sb = pack(tb);
  return needleman_wunsch(sa, sb, 3, -1, -2);
}

double branch_alignment_similarity(std::string_view a, std::string_view b) {
  auto ta = tokenize_simple(a);
  auto tb = tokenize_simple(b);
  auto tok = align_token_sequences(ta, tb);
  auto chr = smith_waterman(a, b);
  // blend local char identity and token identity
  return 0.55 * tok.identity + 0.45 * chr.identity;
}

}}}
