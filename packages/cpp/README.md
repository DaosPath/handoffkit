# HandoffKit (C++)

> **Status: under construction — not published to a package registry**

C++ package for **high-performance contract validation/serialization** of
shared HandoffKit types (`HandoffState`, `RunTrace`, …) with the same JSON
wire format as Python and JavaScript.

## What works today

- Headers and validation helpers
- CMake + CTest fixture round-trips

## What is not ready

- Full multi-agent runtime
- Conan/vcpkg published packages
- Feature parity with Python/`@handoffkit/core`

## Roadmap

Native C++ agent runtime is planned after the Stable API freeze described in
`packages/python/docs/PUBLIC_API.md` and `DEPRECATION.md`.

## Develop

```bash
cmake -S packages/cpp -B packages/cpp/build
cmake --build packages/cpp/build --config Release
ctest --test-dir packages/cpp/build -C Release --output-on-failure
```
