# Security benchmarks

These benchmarks exercise live runtime paths and emit JSON. Every result is an
**Environmental measurement — not a performance guarantee.**

- `node-security-benchmark.mjs`: real TLS 1.3 TCP handshakes, reconnect latency,
  encrypted throughput, process memory deltas, and Ed25519 sign/verify latency.
  It measures `standard` and, only when the active OpenSSL provider exposes it,
  `hybrid-pq` (`X25519MLKEM768`). Unsupported hybrid providers report
  `available: false`; there is no fallback.
- `native_compute_benchmark`: CMake target for the real C++ bounded worker pool.
  It reports job throughput, p50/p95/p99 completion latency, peak pending jobs,
  and observed backpressure rejections.
- `handoffkit-security-benchmark`: Go command for real durable replay and
  revocation writes/restart reloads, transcript build/verify, Ed25519
  sign/verify, and atomic Studio event emit/parse p50/p95/p99 measurements.
  It records Go version, OS, architecture, logical CPUs, providers, build mode,
  samples, warmup, payload size, concurrency, and each disclosed operation batch.
  It does not benchmark a remote ML job or live TLS reload/rotation yet.

Generated results belong under `.local-tests/` and must not be committed.
Each result records runtime/provider, CPU, RAM, OS, architecture, compiler or
runtime version, build mode where applicable, sample count, warmup, payload,
and concurrency. A missing provider is recorded as unavailable; it is never
converted into a successful standard-profile measurement.

```powershell
node benchmarks/security/node-security-benchmark.mjs --iterations=25 --bytes=4194304
go -C packages/go run ./cmd/handoffkit-security-benchmark --iterations=25 --warmup=3
cmake -S packages/cpp -B .local-tests/cpp-bench -DHANDOFFKIT_BUILD_BENCHMARKS=ON
cmake --build .local-tests/cpp-bench --target native_compute_benchmark
```
