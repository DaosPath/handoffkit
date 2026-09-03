# Security validation/benchmarks

These validation/benchmarks exercise live runtime paths and emit JSON. Every result is an
**environmental measurement — not a performance guarantee**.

- `node-security-benchmark.mjs`: real TLS 1.3 TCP handshakes, reconnect latency,
  encrypted throughput, process memory deltas, and Ed25519 sign/verify latency.
  It measures `standard` and, only when the active OpenSSL provider exposes it,
  `hybrid-pq` (`X25519MLKEM768`). Unsupported hybrid providers report
  `available: false`; there is no fallback.
- `native_compute_benchmark`: CMake target for the real C++ bounded worker pool.
  It reports job throughput, p50/p95/p99 completion latency, peak pending jobs,
  and observed backpressure rejections.

Generated results belong under `.local-tests/` and must not be committed.
Each result records runtime/provider, CPU, RAM, OS, architecture, compiler or
runtime version, build mode where applicable, sample count, warmup, payload,
and concurrency. A missing provider is recorded as unavailable; it is never
converted into a successful standard-profile measurement.

```powershell
node validation/benchmarks/security/node-security-benchmark.mjs --iterations=25 --bytes=4194304
cmake -S cpp/packages/handoffkit -B .local-tests/cpp-bench -DHANDOFFKIT_BUILD_BENCHMARKS=ON
cmake --build .local-tests/cpp-bench --target native_compute_benchmark
```
