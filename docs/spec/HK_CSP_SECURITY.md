# HK-CSP Security Model

HK-CSP transports data; it does not grant authority. Receiving a tool call,
command, path, URL, job, or artifact reference never implies permission to use
it.

Required safeguards:

- validate every envelope before dispatch,
- reject unsupported major protocol versions,
- enforce frame and channel limits before allocating large buffers,
- redact credentials from errors, traces, logs, and metadata,
- use explicit argv arrays for child processes and never enable a shell
  implicitly,
- keep stdio stdout protocol-only,
- resolve filesystem artifacts through the runtime workspace policy,
- require existing tool sandbox and approval policies for mutating operations,
- authenticate and encrypt network transports before production use,
- bound retries, deduplication storage, process count, and pending ACKs.

The 1.17 Rust implementation adds bounded NDJSON parsing, nesting-depth checks,
process and pending-ACK limits, subprocess `kill_on_drop`, timeout-based
shutdown, unknown-message NACKs, and credential-pattern redaction. Python and
JavaScript remain wire-compatible local peers.

Current transports are local in-process and stdio/subprocess only. TCP,
WebSocket, Unix sockets, authentication, and encryption are not implemented in
1.17. Future network adapters must be opt-in and must not listen publicly by
default.
